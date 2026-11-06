"""Runtime hooks for the in-browser demo (the backend on Pyodide).

Pyodide has no threads and no sockets, so the real backend runs there with a
few things swapped out. All of it sits behind ONE flag - the env var
INBOXRAKE_DEMO=1 (`enabled()`) - and the explicit `install()` the Pyodide
worker calls at boot. Without the flag nothing here is active and nothing is
patched (`install()` is never called by the backend itself).

  * threads: anyio's hand-off to a worker thread (every `def` endpoint, sync
    StreamingResponse iterators) calls inline; `Thread.start()` of a job
    worker runs its target inline, DEFERRED until the current handler has
    returned (the callers hold the non-reentrant `acc.lock`, so running at
    `.start()` would deadlock the one thread); scheduler loops are skipped;
    ThreadPoolExecutor is an inline executor.
  * sockets: `socket.create_connection` / `getaddrinfo` raise a coded
    "not available in the demo" error - IMAP, SMTP, unsubscribe, OAuth, OIDC
    and AI providers all end there.
  * Fernet: a stand-in for the 2.4 MB `cryptography` wheel (the demo holds
    no secrets).
  * `anthropic`: a stub module so `import anthropic` (for an exception
    type) works with the SDK unloaded.
  * `request()`: the in-process ASGI call the worker's fetch bridge uses.

`uninstall()` undoes `install()` (the tests use it)."""

from __future__ import annotations

import base64
import concurrent.futures as cf
import json
import logging
import os
import sys
import threading
import types

log = logging.getLogger("inboxrake.demo")

ENV_VAR = "INBOXRAKE_DEMO"


def enabled() -> bool:
    """Whether this process is the in-browser demo (read at call time)."""
    return os.environ.get(ENV_VAR, "").strip().lower() in ("1", "true", "yes", "on")


def refusal() -> RuntimeError:
    """The coded "not available in the demo" error (`errortext` / the UI
    word it); `raise demo.refusal()`."""
    from . import mailops
    return RuntimeError(mailops.coded(mailops.NOT_IN_DEMO))


class NotAvailableInDemo(OSError):
    """What the denied socket layer raises. Its text is the code, so every
    caller that records `str(exc)` (job errors, unsubscribe, digest) ends up
    with the translated message."""

    def __init__(self):
        from . import mailops
        super().__init__(mailops.coded(mailops.NOT_IN_DEMO))


def denied(exc: BaseException | None) -> bool:
    """Whether `exc` is (or wraps, like urllib's URLError) the denied
    network."""
    seen = 0
    while exc is not None and seen < 8:
        if isinstance(exc, NotAvailableInDemo):
            return True
        exc = getattr(exc, "reason", None) \
            if isinstance(getattr(exc, "reason", None), BaseException) \
            else exc.__cause__ or exc.__context__
        seen += 1
    return False


# --------------------------------------------------------------- threads

_depth = 0                                   # sync handlers running inline
_deferred: list[threading.Thread] = []       # job workers waiting for them
_saved: dict[str, object] = {}               # originals, while installed


def _run_job(thread: threading.Thread) -> None:
    # A shim-run thread is never marked started: join() raises and
    # is_alive() is False. Nothing on the demo path joins; keep it so.
    try:
        thread.run()
    except Exception:
        log.exception("demo: inline job failed")


def _start(self: threading.Thread) -> None:
    if getattr(getattr(self, "_target", None), "__name__", "") == "loop":
        return                               # autoscan / digest / rules schedulers
    if _depth:
        _deferred.append(self)
    else:
        _run_job(self)


async def _run_sync(func, *args, **_options):
    """Stands in for `anyio.to_thread.run_sync`: call inline; once the
    outermost handler has returned, run the jobs it started."""
    global _depth
    _depth += 1
    try:
        return func(*args)
    finally:
        _depth -= 1
        while not _depth and _deferred:
            _depth += 1
            try:
                _run_job(_deferred.pop(0))
            finally:
                _depth -= 1


class InlineExecutor:
    """ThreadPoolExecutor stand-in: `submit` runs the call right away."""

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def submit(self, fn, *args, **kwargs) -> cf.Future:
        future: cf.Future = cf.Future()
        try:
            future.set_result(fn(*args, **kwargs))
        except BaseException as exc:         # noqa: BLE001 - like a pool
            future.set_exception(exc)
        return future

    def map(self, fn, *iterables):
        return [fn(*args) for args in zip(*iterables)]

    def shutdown(self, *args, **kwargs):
        pass


# --------------------------------------------------------------- sockets

def _deny(*args, **kwargs):
    raise NotAvailableInDemo()


# ----------------------------------------------------------- stand-ins

class InvalidToken(Exception):
    pass


class Fernet:
    """`cryptography.fernet.Fernet` stand-in: same calls, no encryption. The
    demo holds no secrets; this only keeps secretbox's round trip working."""

    def __init__(self, key=None):
        pass

    def encrypt(self, data: bytes) -> bytes:
        return base64.urlsafe_b64encode(data)

    def decrypt(self, token: bytes, ttl=None) -> bytes:
        try:
            return base64.urlsafe_b64decode(token)
        except Exception as exc:
            raise InvalidToken() from exc


def _fernet_modules() -> dict[str, types.ModuleType]:
    fernet = types.ModuleType("cryptography.fernet")
    fernet.Fernet, fernet.InvalidToken = Fernet, InvalidToken
    package = types.ModuleType("cryptography")
    package.fernet = fernet
    package.__path__ = []
    return {"cryptography": package, "cryptography.fernet": fernet}


def _anthropic_stub() -> types.ModuleType:
    def client(*args, **kwargs):
        raise refusal()
    stub = types.ModuleType("anthropic")
    stub.BadRequestError = type("BadRequestError", (Exception,), {})
    stub.Anthropic = stub.AnthropicFoundry = client
    return stub


# --------------------------------------------------------------- install

def installed() -> bool:
    return bool(_saved)


def install(*, fernet: bool = True) -> None:
    """Make the backend run on a single thread without a network. Idempotent.
    `fernet=False` keeps a real `cryptography` (tests; a stock Python where
    it is installed); the Pyodide worker leaves it on."""
    if installed():
        return
    import socket
    import anyio.to_thread
    _saved.update(
        env=os.environ.get(ENV_VAR),         # one flag: installed == enabled
        thread_start=threading.Thread.start,
        executor=cf.ThreadPoolExecutor,
        run_sync=anyio.to_thread.run_sync,
        create_connection=socket.create_connection,
        getaddrinfo=socket.getaddrinfo,
        modules={})
    os.environ[ENV_VAR] = "1"
    threading.Thread.start = _start
    cf.ThreadPoolExecutor = InlineExecutor
    # aisort did `from concurrent.futures import ThreadPoolExecutor`
    from . import aisort
    _saved["aisort_executor"] = aisort.ThreadPoolExecutor
    aisort.ThreadPoolExecutor = InlineExecutor
    anyio.to_thread.run_sync = _run_sync
    socket.create_connection = _deny
    socket.getaddrinfo = _deny
    stubs = {"anthropic": _anthropic_stub()}
    if fernet:
        stubs.update(_fernet_modules())
    for name, module in stubs.items():
        _saved["modules"][name] = sys.modules.get(name)
        sys.modules[name] = module
    log.info("demo hooks installed (no threads, no network)")


def uninstall() -> None:
    """Undo `install()` (tests)."""
    if not installed():
        return
    import socket
    import anyio.to_thread
    if _saved["env"] is None:
        os.environ.pop(ENV_VAR, None)
    else:
        os.environ[ENV_VAR] = _saved["env"]
    threading.Thread.start = _saved["thread_start"]
    cf.ThreadPoolExecutor = _saved["executor"]
    from . import aisort
    aisort.ThreadPoolExecutor = _saved["aisort_executor"]
    anyio.to_thread.run_sync = _saved["run_sync"]
    socket.create_connection = _saved["create_connection"]
    socket.getaddrinfo = _saved["getaddrinfo"]
    for name, old in _saved["modules"].items():
        if old is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = old
    _deferred.clear()
    _saved.clear()


# ------------------------------------------------------------------ ASGI

async def request(method: str, path: str, query: str = "", body=None,
                  headers: dict[str, str] | None = None, *, app=None) -> dict:
    """One in-process HTTP call to the app - the Pyodide worker's bridge.

    `body` is bytes, str, or anything JSON-serialisable (sent as JSON; a body
    without a Content-Type header is JSON);
    `query` is the raw query string without the `?`. The Host is
    `localhost` (what the host guard accepts). Returns
    `{"status": int, "headers": [[name, value], ...], "body": bytes}`; the
    header list keeps repeats (Set-Cookie) and the case the app used."""
    if app is None:
        from .main import app
    if body is None:
        raw = b""
    elif isinstance(body, bytes):
        raw = body
    elif isinstance(body, str):
        raw = body.encode()
    else:
        raw = json.dumps(body).encode()
    sent = [(b"host", b"localhost"), (b"content-length", str(len(raw)).encode())]
    given = {name.lower(): value for name, value in (headers or {}).items()}
    if raw and "content-type" not in given:
        given["content-type"] = "application/json"
    sent += [(name.encode(), value.encode()) for name, value in given.items()]
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
             "method": method.upper(), "scheme": "http", "path": path,
             "raw_path": path.encode(), "query_string": query.encode(),
             "root_path": "", "headers": sent, "client": ("127.0.0.1", 1),
             "server": ("localhost", 80)}
    pending = [{"type": "http.request", "body": raw, "more_body": False}]
    out: dict = {"status": 0, "headers": [], "body": b""}

    async def receive():
        return pending.pop(0) if pending else {"type": "http.disconnect"}

    async def send(message):
        if message["type"] == "http.response.start":
            out["status"] = message["status"]
            out["headers"] = [[k.decode("latin-1"), v.decode("latin-1")]
                              for k, v in message["headers"]]
        elif message["type"] == "http.response.body":
            out["body"] += message.get("body", b"")

    try:
        await app(scope, receive, send)
    except Exception:
        # an unhandled error: Starlette has already sent its 500 and
        # re-raised; hand that response on instead of crashing the bridge
        if not out["status"]:
            raise
        log.exception("demo: unhandled error in %s %s", method, path)
    return out
