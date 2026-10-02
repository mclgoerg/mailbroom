"""Saved filter presets: CRUD, per-account scoping, tenant separation,
rename-follows, cap enforcement, atomic write, corrupt-file tolerance."""

import json

from fastapi.testclient import TestClient

from backend import config as cfgmod
from backend import presets as presetsmod
from backend.main import app

client = TestClient(app)


def test_crud():
    r = client.post("/api/presets", json={"name": "Old shipping",
                                          "query": "tag:shipping age:>1y"})
    assert r.status_code == 200
    preset = r.json()
    assert preset["name"] == "Old shipping"
    assert preset["query"] == "tag:shipping age:>1y"
    assert preset["account"] == "default"

    assert client.get("/api/presets").json() == {"presets": [preset]}

    assert client.delete(f"/api/presets/{preset['id']}").json() == {"ok": True}
    assert client.delete(f"/api/presets/{preset['id']}").status_code == 404
    assert client.get("/api/presets").json() == {"presets": []}


def test_name_is_trimmed_and_capped_and_required():
    r = client.post("/api/presets",
                    json={"name": "  padded  ", "query": "x"})
    assert r.json()["name"] == "padded"

    long_name = "n" * 200
    r = client.post("/api/presets", json={"name": long_name, "query": ""})
    assert len(r.json()["name"]) == presetsmod.NAME_MAX

    assert client.post("/api/presets",
                       json={"name": "   ", "query": "x"}).status_code == 400
    assert client.post("/api/presets",
                       json={"name": "", "query": "x"}).status_code == 400


def test_query_is_stored_verbatim_and_capped():
    long_query = "x" * 500
    r = client.post("/api/presets", json={"name": "big", "query": long_query})
    assert len(r.json()["query"]) == presetsmod.QUERY_MAX
    assert r.json()["query"] == long_query[:presetsmod.QUERY_MAX]


def test_delete_unknown_404():
    assert client.delete("/api/presets/nope").status_code == 404


def test_cap_enforced_per_account():
    for i in range(presetsmod.PRESET_CAP):
        r = client.post("/api/presets", json={"name": f"p{i}", "query": "x"})
        assert r.status_code == 200
    r = client.post("/api/presets", json={"name": "one too many", "query": "x"})
    assert r.status_code == 400
    assert "20" in r.json()["detail"]
    assert len(presetsmod.load_presets()) == presetsmod.PRESET_CAP


def test_per_account_scoping(monkeypatch):
    from conftest import FakeIMAP
    from backend import mailops
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "one": {"host": "host-one", "user": "u1", "password": "pw"},
        "two": {"host": "host-two", "user": "u2", "password": "pw"},
    }}))
    monkeypatch.setattr(mailops, "connect",
                        lambda im, name=None: FakeIMAP({"INBOX": []}))

    r1 = client.post("/api/presets?account=one",
                     json={"name": "one's preset", "query": "a"})
    assert r1.status_code == 200 and r1.json()["account"] == "one"
    r2 = client.post("/api/presets?account=two",
                     json={"name": "two's preset", "query": "b"})
    assert r2.status_code == 200 and r2.json()["account"] == "two"

    # Each account's live state only mirrors its own presets.
    st_one = client.get("/api/state?account=one").json()
    st_two = client.get("/api/state?account=two").json()
    assert [p["name"] for p in st_one["presets"]] == ["one's preset"]
    assert [p["name"] for p in st_two["presets"]] == ["two's preset"]

    # Unknown account is rejected, same as every other account-scoped call.
    assert client.post("/api/presets?account=nope",
                       json={"name": "x", "query": "x"}).status_code == 400


def test_rename_account_follows():
    client.post("/api/presets", json={"name": "mine", "query": "x"})
    r = client.post("/api/config", json={
        "rename_account": {"from": "default", "to": "renamed"}})
    assert r.status_code == 200
    presets = presetsmod.load_presets()
    assert presets[0]["account"] == "renamed"
    st = client.get("/api/state?account=renamed").json()
    assert [p["name"] for p in st["presets"]] == ["mine"]


def test_delete_account_drops_its_presets(monkeypatch):
    from conftest import FakeIMAP
    from backend import mailops
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "one": {"host": "host-one", "user": "u1", "password": "pw"},
        "two": {"host": "host-two", "user": "u2", "password": "pw"},
    }}))
    monkeypatch.setattr(mailops, "connect",
                        lambda im, name=None: FakeIMAP({"INBOX": []}))
    client.post("/api/presets?account=one", json={"name": "a", "query": "x"})
    client.post("/api/presets?account=two", json={"name": "b", "query": "x"})

    r = client.post("/api/config", json={"delete_account": "one"})
    assert r.status_code == 200
    names = [p["name"] for p in presetsmod.load_presets()]
    assert names == ["b"]


def test_tolerates_missing_or_corrupt_file(tmp_path, monkeypatch):
    missing = tmp_path / "nope.json"
    monkeypatch.setattr(presetsmod, "PRESETS_PATH", missing)
    assert not missing.exists()
    assert presetsmod.load_presets() == []

    corrupt = tmp_path / "corrupt.json"
    corrupt.write_text("{not json")
    monkeypatch.setattr(presetsmod, "PRESETS_PATH", corrupt)
    assert presetsmod.load_presets() == []


def test_save_is_atomic_and_chmod_0600(tmp_path, monkeypatch):
    path = tmp_path / "presets.json"
    monkeypatch.setattr(presetsmod, "PRESETS_PATH", path)
    presetsmod.create_preset({"name": "a", "query": "x"})
    assert path.exists()
    assert not path.with_suffix(".tmp").exists()
    assert oct(path.stat().st_mode)[-3:] == "600"
    data = json.loads(path.read_text())
    assert data["presets"][0]["name"] == "a"
