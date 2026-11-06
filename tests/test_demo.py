"""The in-browser demo's backend hooks (backend/demo.py): inert without the
flag, and with the shim installed the app runs on ONE thread with no
sockets - jobs finish inside the request that started them."""

import asyncio
import json
import socket
import sys
import threading

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import aihelper, demo, errortext, mailops, oauthflow, secretbox
from backend import smtpout, unsub
from backend.main import app
from conftest import wait_delete_done, wait_scan_done

CODE = "not_in_demo"


def call(method, path, query="", body=None, **kw):
    return asyncio.run(demo.request(method, path, query, body, **kw))


def jbody(res):
    return json.loads(res["body"])


@pytest.fixture
def shim():
    """Install the demo hooks (the real cryptography stays: it is there)."""
    demo.install(fernet=False)
    yield
    demo.uninstall()


# ------------------------------------------------------------- flag off

def test_flag_off_nothing_is_patched():
    assert not demo.enabled() and not demo.installed()
    assert threading.Thread.start.__module__ == "threading"
    assert socket.create_connection.__module__ == "socket"
    assert socket.getaddrinfo.__module__ == "socket"
    import anyio.to_thread
    assert anyio.to_thread.run_sync.__module__.startswith("anyio")
    assert "anthropic" not in sys.modules or sys.modules["anthropic"].__file__
    # the normal path is untouched: a real thread runs the job
    seen = []
    t = threading.Thread(target=lambda: seen.append(threading.get_ident()))
    t.start()
    t.join()
    assert seen and seen[0] != threading.get_ident()


def test_flag_off_connect_is_the_real_one():
    with pytest.raises(RuntimeError, match="no_account"):
        mailops.connect({"host": "", "user": "", "password": ""})


@pytest.mark.parametrize("value, on", [
    ("1", True), ("true", True), ("on", True), ("", False), ("0", False)])
def test_the_flag_is_an_env_var(monkeypatch, value, on):
    monkeypatch.setenv(demo.ENV_VAR, value)
    assert demo.enabled() is on


def test_install_is_idempotent_and_undone(shim):
    originals = dict(demo._saved)
    demo.install()
    assert demo._saved == originals
    demo.uninstall()
    assert not demo.installed()
    assert threading.Thread.start.__module__ == "threading"
    assert socket.create_connection.__module__ == "socket"
    demo.install(fernet=False)               # the fixture undoes it again


# ------------------------------------------- jobs through the ASGI adapter

def test_scan_delete_undo_run_on_one_thread(bridge, shim):
    main = threading.get_ident()
    started = []
    real_run = demo._run_job
    demo._run_job = lambda t: (started.append(threading.get_ident()),
                               real_run(t))[1]
    try:
        assert call("POST", "/api/scan", body={})["status"] == 200
        # the scan ran before the response was sent: no waiting needed
        state = jbody(call("GET", "/api/state"))
        assert state["status"] == "done", state.get("error")
        group = call("GET", "/api/group",
                     "grouping=sender&key=noreply%40dhl.example")
        assert group["status"] == 200

        res = call("POST", "/api/delete", body={
            "grouping": "sender", "keys": ["noreply@dhl.example"]})
        assert res["status"] == 200, res["body"]
        assert mailops.STATE["delete"]["status"] != "running"
        assert mailops.STATE["delete"]["moved"] == 3
        assert "noreply@dhl.example" not in \
            mailops.STATE["groups"]["sender"]

        res = call("POST", "/api/undo", body={})
        assert res["status"] == 200 and jbody(res)["restored"] == 3
        assert "noreply@dhl.example" in mailops.STATE["groups"]["sender"]
    finally:
        demo._run_job = real_run
    assert started and set(started) == {main}


def test_responses_match_the_normal_path(bridge):
    client = TestClient(app)
    body = {"grouping": "sender", "keys": ["noreply@dhl.example"]}

    assert client.post("/api/scan", json={}).json() == {"ok": True}
    wait_scan_done()
    csv = client.get("/api/export?grouping=sender")
    deleted = client.post("/api/delete", json=body)
    wait_delete_done()
    assert client.post("/api/undo", json={}).status_code == 200
    wait_scan_done()
    accountsmod.reset()

    demo.install(fernet=False)
    try:
        call("POST", "/api/scan", body={})
        res = call("GET", "/api/export", "grouping=sender")
        shim_deleted = call("POST", "/api/delete", body=body)
    finally:
        demo.uninstall()
    assert res["status"] == csv.status_code == 200
    assert res["body"].decode() == csv.text
    headers = dict(res["headers"])
    assert headers["content-type"].startswith("text/csv")
    assert headers["content-disposition"] == \
        csv.headers["content-disposition"]
    assert shim_deleted["status"] == deleted.status_code == 200
    assert jbody(shim_deleted) == deleted.json()


def test_adapter_shapes(shim):
    res = call("GET", "/api/auth")
    assert res["status"] == 200 and isinstance(res["body"], bytes)
    assert all(isinstance(k, str) and isinstance(v, str)
               for k, v in res["headers"])
    # body as str / bytes / JSON all arrive as the same request
    assert call("POST", "/api/undo", body='{}')["status"] == 409
    assert call("POST", "/api/undo", body=b'{}')["status"] == 409
    assert call("POST", "/api/undo", body={})["status"] == 409
    assert call("GET", "/api/nope")["status"] == 404


def test_a_deferred_job_runs_after_the_handler(shim):
    order = []

    def handler():
        t = threading.Thread(target=lambda: order.append("job"))
        t.start()
        order.append("handler returned")

    asyncio.run(demo._run_sync(handler))
    assert order == ["handler returned", "job"]


def test_a_failing_job_does_not_break_the_request(shim, caplog):
    def handler():
        threading.Thread(target=lambda: 1 / 0).start()
        return "ok"

    assert asyncio.run(demo._run_sync(handler)) == "ok"
    assert "inline job failed" in caplog.text


def test_scheduler_loops_are_skipped(shim):
    ran = []

    def loop():
        ran.append(1)
    threading.Thread(target=loop, daemon=True).start()
    assert ran == []


def test_the_executor_runs_inline(shim):
    import concurrent.futures as cf
    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(threading.get_ident) for _ in range(3)]
    assert {f.result() for f in futures} == {threading.get_ident()}
    bad = cf.ThreadPoolExecutor().submit(lambda: 1 / 0)
    with pytest.raises(ZeroDivisionError):
        bad.result()


# ------------------------------------------------------------ the network

def test_sockets_are_denied(shim):
    for fn, args in ((socket.create_connection, (("host.example", 443),)),
                     (socket.getaddrinfo, ("host.example", 443))):
        with pytest.raises(OSError) as err:
            fn(*args)
        assert str(err.value) == CODE
        assert demo.denied(err.value)
    assert not demo.denied(OSError("other"))


def test_unsubscribe_over_http_surfaces_the_code(shim):
    with pytest.raises(RuntimeError, match=CODE):
        unsub._post_one_click("https://shop.example/u/1")
    assert unsub.classify(OSError(CODE)) == CODE


def test_unsubscribe_endpoint_maps_the_code(bridge, shim):
    call("POST", "/api/scan", body={})
    res = call("POST", "/api/unsubscribe", body={
        "grouping": "sender", "key": "news@shop.example"})
    assert res["status"] == 400
    assert jbody(res)["detail"] == CODE
    assert errortext.describe(CODE) == "Not available in the demo."


def test_smtp_surfaces_the_code(shim):
    im = {"host": "imap.example", "user": "me@self.example",
          "password": "x", "smtp_host": "smtp.example", "smtp_port": 587,
          "smtp_security": "starttls"}
    with pytest.raises(OSError) as err:
        smtpout.send(im, "to@shop.example", "s", "b")
    assert mailops.error_text(err.value) == CODE


def test_oauth_and_oidc_http_surface_the_code(shim):
    from backend import auth
    for fetch in (oauthflow._http_json, auth._http_json):
        with pytest.raises(RuntimeError, match=CODE):
            fetch("https://idp.example/token")


def test_a_urlerror_wrapping_the_denial_is_recognised(shim):
    import urllib.request
    with pytest.raises(Exception) as err:
        urllib.request.urlopen("https://host.example/")
    assert demo.denied(err.value)
    assert mailops.error_text(err.value) == CODE


# ------------------------------------------------ connect / AI refusals

def test_connect_is_refused_in_the_demo(monkeypatch):
    monkeypatch.setenv(demo.ENV_VAR, "1")
    with pytest.raises(RuntimeError) as err:
        mailops.connect({"host": "imap.real-server.example",
                         "user": "me@self.example", "password": "x"})
    assert str(err.value) == CODE
    assert mailops.is_coded(str(err.value))


def test_test_connection_endpoint_refuses_cleanly(monkeypatch):
    monkeypatch.setenv(demo.ENV_VAR, "1")
    client = TestClient(app)
    client.post("/api/config", json={"imap": {
        "host": "imap.real-server.example", "user": "me@self.example",
        "password": "x"}})
    r = client.post("/api/test_connection")
    assert r.status_code == 502 and r.json()["detail"] == CODE


def test_ai_is_refused_in_the_demo(monkeypatch):
    monkeypatch.setenv(demo.ENV_VAR, "1")
    for provider in ("anthropic", "foundry", "openai", "ollama"):
        cfg = {"ai": {"provider": provider, "api_key": "k",
                      "foundry_endpoint": "https://ai.example"}}
        with pytest.raises(RuntimeError, match=CODE):
            aihelper._ai_call(cfg, "model", "system", {}, {})


def test_the_anthropic_stub_serves_the_exception_import(shim):
    import anthropic
    assert issubclass(anthropic.BadRequestError, Exception)
    with pytest.raises(RuntimeError, match=CODE):
        anthropic.Anthropic(api_key="k")


# ---------------------------------------------------------------- Fernet

def test_the_fernet_stand_in_round_trips():
    f = demo.Fernet(b"ignored")
    token = f.encrypt(b"secret value")
    assert f.decrypt(token) == b"secret value"
    with pytest.raises(demo.InvalidToken):
        f.decrypt(b"\xff not base64 \xff")


def test_secretbox_works_on_the_stand_in(monkeypatch):
    monkeypatch.setenv(secretbox.ENV_VAR, "demo-only-key")
    demo.install(fernet=True)
    try:
        import cryptography.fernet as fernet
        assert fernet.Fernet is demo.Fernet
        sealed = secretbox.seal("hunter2")
        assert sealed.startswith(secretbox.PREFIX) and sealed != "hunter2"
        assert secretbox.unseal(sealed) == "hunter2"
    finally:
        demo.uninstall()
    import cryptography.fernet as fernet
    assert fernet.Fernet is not demo.Fernet           # the real one is back


# ----------------------------------------------------------- static mount

def test_main_imports_without_an_assets_folder(tmp_path):
    import subprocess
    (tmp_path / "static").mkdir()
    (tmp_path / "static" / "index.html").write_text("<html></html>")
    out = subprocess.run(
        [sys.executable, "-c", "import backend.main"], capture_output=True,
        text=True, env={**__import__("os").environ,
                        "STATIC_DIR": str(tmp_path / "static")},
        cwd=str(__import__("pathlib").Path(__file__).resolve().parent.parent))
    assert out.returncode == 0, out.stderr
