"""Password login: failures are counted per peer address and slow down."""

import threading

from fastapi.testclient import TestClient

from backend import auth as authmod
from backend import config as cfgmod
from backend import main
from backend.main import app


class Clock:
    def __init__(self):
        self.now = 1_000_000.0

    def __call__(self):
        return self.now


def _setup(monkeypatch):
    cfgmod.update_config({"auth": {"mode": "password", "password": "right"}})
    clock = Clock()
    monkeypatch.setattr(authmod, "login_throttle",
                        authmod.LoginThrottle(clock=clock))
    return clock


def _try(c, pw):
    return c.post("/api/login", json={"password": pw})


def _fail(c, n):
    for _ in range(n):
        assert _try(c, "wrong").status_code == 401


def test_sixth_attempt_is_429_even_with_the_right_password(monkeypatch):
    _setup(monkeypatch)
    c = TestClient(app)
    _fail(c, 5)
    r = _try(c, "right")
    assert r.status_code == 429
    assert r.json()["detail"] == "login_throttled:n=15"
    assert r.headers["retry-after"] == "900"
    assert "pmc_session" not in r.cookies


def test_window_expiry_lets_the_peer_in_again(monkeypatch):
    clock = _setup(monkeypatch)
    c = TestClient(app)
    _fail(c, 5)
    clock.now += 899
    r = _try(c, "right")
    assert r.status_code == 429                    # a refusal adds no failure
    assert r.json()["detail"] == "login_throttled:n=1"
    clock.now += 2
    assert _try(c, "right").status_code == 200


def test_failures_age_out_individually(monkeypatch):
    clock = _setup(monkeypatch)
    c = TestClient(app)
    _fail(c, 3)
    clock.now += 600
    _fail(c, 2)                                    # 5 within 15 min
    assert _try(c, "right").status_code == 429
    clock.now += 301                               # the first three are gone
    assert _try(c, "right").status_code == 200


def test_success_resets_the_count(monkeypatch):
    _setup(monkeypatch)
    c = TestClient(app)
    _fail(c, 4)
    assert _try(c, "right").status_code == 200
    _fail(c, 4)
    assert _try(c, "right").status_code == 200


def test_another_address_is_unaffected(monkeypatch):
    _setup(monkeypatch)
    a = TestClient(app, client=("10.0.0.1", 5000))
    b = TestClient(app, client=("10.0.0.2", 5000))
    _fail(a, 5)
    assert _try(a, "right").status_code == 429
    assert _try(b, "right").status_code == 200


def test_x_forwarded_for_is_not_trusted(monkeypatch):
    _setup(monkeypatch)
    c = TestClient(app)
    for i in range(5):
        r = c.post("/api/login", json={"password": "wrong"},
                   headers={"X-Forwarded-For": f"203.0.113.{i}"})
        assert r.status_code == 401
    r = c.post("/api/login", json={"password": "right"},
               headers={"X-Forwarded-For": "203.0.113.99"})
    assert r.status_code == 429


def test_the_hash_check_runs_in_a_worker_thread(monkeypatch):
    _setup(monkeypatch)
    seen = []
    real = authmod.verify_password

    def spy(password, stored):
        seen.append(threading.current_thread() is threading.main_thread())
        return real(password, stored)

    monkeypatch.setattr(authmod, "verify_password", spy)
    assert _try(TestClient(app), "right").status_code == 200
    # TestClient drives the app from a portal thread; a worker thread is
    # neither that nor the test's main thread.
    pool = []
    orig = main.run_in_threadpool

    async def tracking(fn, *a, **kw):
        pool.append(fn)
        return await orig(fn, *a, **kw)

    monkeypatch.setattr(main, "run_in_threadpool", tracking)
    assert _try(TestClient(app), "right").status_code == 200
    assert pool == [spy]
    assert seen == [False, False]


def test_throttle_table_stays_bounded():
    clock = Clock()
    t = authmod.LoginThrottle(clock=clock)
    for i in range(1500):
        t.failed(f"10.0.{i // 250}.{i % 250}")
    clock.now += 901
    t.failed("late")
    assert len(t._fails) == 1
