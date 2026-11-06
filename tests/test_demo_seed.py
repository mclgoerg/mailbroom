"""`scripts/demo.py` split into a build step and a serve step.

`--build-seed DIR` generates + scans the demo mailboxes and persists the
data dir and the FakeIMAP servers; `--from-seed DIR` serves them without
generating anything. Both must show exactly the data the plain
generate-at-start path shows. Each run is a subprocess (demo.py configures
the backend through the environment at import time).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / "scripts" / "demo.py"
# fixed clock: mail dates and scan stamps derive from it
# (PYTHONHASHSEED: a few data files list set members, so byte-for-byte
# reproducible seeds - what the bundle build makes - need a fixed hash seed)
ENV = {**os.environ, "DEMO_NOW": "1790000000", "LOG_LEVEL": "WARNING",
       "PYTHONHASHSEED": "0"}

# Runs demo.py's main() in-process (without the server) and dumps what the UI
# reads. A bad seed makes main() exit with "demo: <why>".
DRIVER = r"""
import json, os, runpy, sys, time
path, args = sys.argv[1], sys.argv[2:]
if os.environ.get("PIN_CLOCK"):        # as if the process ran at that instant
    sys.path.insert(0, os.path.dirname(path))
    import demo_seed
    demo_seed.set_clock(float(os.environ["PIN_CLOCK"]))
runpy.run_path(path, run_name="demo_driver")["main"](args, serve=False)
if "--build-seed" in args:
    sys.exit(0)
from fastapi.testclient import TestClient
from backend.main import app
c = TestClient(app, base_url="http://localhost")
out = {"clock": time.time()}
for acct in ("proton", "icloud"):
    out[acct] = {"state": c.get("/api/state", params={"account": acct}).json(),
                 "stats": c.get("/api/stats", params={"account": acct}).json()}
print(json.dumps(out, sort_keys=True))
"""


def run_demo(*args: str, check: bool = True,
             env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-c", DRIVER, str(DEMO), *args], env=env or ENV,
        capture_output=True, text=True, timeout=300, check=check)


def dump(proc: subprocess.CompletedProcess) -> dict:
    return json.loads(proc.stdout.strip().splitlines()[-1])


@pytest.fixture(scope="module")
def seed(tmp_path_factory) -> Path:
    path = tmp_path_factory.mktemp("seed") / "seed"
    run_demo("--build-seed", str(path))
    return path


# What differs between two starts whatever the data: the creation stamp and
# id of rules, the scan's wall-clock stamps and its revision counter. Scoped
# to these paths so anything else that goes missing is caught.
def scrub(d: dict) -> dict:
    d.pop("clock")
    for acct in ("proton", "icloud"):
        st = d[acct]["state"]
        for k in ("scanned_ts", "groups_rev"):
            st.pop(k)
        st["delete"].pop("seq")
        for r in st["rules"]:
            r.pop("id")
            r.pop("created")
        d[acct]["stats"]["scans"][-1].pop("ts")
    return d


def test_the_seed_serves_the_same_state_and_stats(seed):
    # a seed shifts the clock back to its build time; the generated run is
    # pinned to the same instant, so both see the same "now"
    generated = dump(run_demo(env={**ENV, "PIN_CLOCK": ENV["DEMO_NOW"]}))
    served = dump(run_demo("--from-seed", str(seed)))
    assert generated["proton"]["state"]["notice"]            # not vacuous
    assert scrub(served) == scrub(generated)
    assert generated["proton"]["state"]["groups"]["sender"]   # not vacuous


def test_the_seed_layout_and_determinism(seed, tmp_path):
    again = tmp_path / "again"
    run_demo("--build-seed", str(again))
    manifest = json.loads((seed / "seed.json").read_text())
    assert manifest["format"] == 2
    assert "fakes.pkl" in manifest["files"]
    assert any(f.startswith("data/scan_") for f in manifest["files"])
    assert not any("session_secret" in f for f in manifest["files"])
    assert manifest["built_at"] == float(ENV["DEMO_NOW"])
    # with the instant pinned a seed is byte-for-byte reproducible: the clock
    # stands still while it is generated, random ids come from a fixed
    # generator, SQLite files are written in canonical form
    assert (again / "seed.json").read_bytes() == (seed / "seed.json").read_bytes()
    for rel in manifest["files"]:
        assert (again / rel).read_bytes() == (seed / rel).read_bytes(), rel


def test_serving_does_not_modify_the_seed(seed):
    before = (seed / "seed.json").read_text()
    run_demo("--from-seed", str(seed))
    assert (seed / "seed.json").read_text() == before


@pytest.mark.parametrize("damage, message", [
    ("missing", "no usable demo seed"),
    ("manifest", "no usable demo seed"),
    ("version", "format"),
    ("data", "corrupted"),
    ("pickle", "different code"),
    ("gone", "incomplete"),
])
def test_a_bad_seed_fails_with_a_clear_message(seed, tmp_path, damage, message):
    import shutil
    bad = tmp_path / "bad"
    if damage != "missing":
        shutil.copytree(seed, bad)
    manifest = bad / "seed.json"
    if damage == "manifest":
        manifest.write_text("not json")
    elif damage == "version":
        m = json.loads(manifest.read_text())
        m["format"] = 99
        manifest.write_text(json.dumps(m))
    elif damage == "data":
        victim = next((bad / "data").glob("scan_*.json"))
        victim.write_text(victim.read_text() + " ")
    elif damage == "pickle":
        import hashlib
        blob = b"\x80\x04garbage"          # checksum fine, content unreadable
        (bad / "fakes.pkl").write_bytes(blob)
        m = json.loads(manifest.read_text())
        m["files"]["fakes.pkl"] = hashlib.sha256(blob).hexdigest()
        manifest.write_text(json.dumps(m))
    elif damage == "gone":
        next((bad / "data").glob("scan_*.json")).unlink()
    p = run_demo("--from-seed", str(bad), check=False)
    assert p.returncode != 0
    assert "demo: " in p.stderr and message in p.stderr


def test_build_seed_refuses_a_directory_that_is_not_a_seed(tmp_path):
    keep = tmp_path / "project"
    keep.mkdir()
    (keep / "precious.txt").write_text("x")
    p = run_demo("--build-seed", str(keep), check=False)
    assert p.returncode != 0 and "not a demo seed" in p.stderr
    assert (keep / "precious.txt").read_text() == "x"
    empty = tmp_path / "empty"
    empty.mkdir()
    run_demo("--build-seed", str(empty))             # empty: fine
    run_demo("--build-seed", str(empty))             # an earlier seed: fine


def test_an_unusable_snapshot_in_the_seed_fails_loudly(seed, tmp_path):
    import hashlib
    import shutil
    bad = tmp_path / "bad"
    shutil.copytree(seed, bad)
    snap = next((bad / "data").glob("scan_*.json"))
    snap.write_text("{}")
    m = json.loads((bad / "seed.json").read_text())
    m["files"][f"data/{snap.name}"] = hashlib.sha256(b"{}").hexdigest()
    (bad / "seed.json").write_text(json.dumps(m))
    p = run_demo("--from-seed", str(bad), check=False)
    assert p.returncode != 0 and "snapshot" in p.stderr


def test_an_old_seed_still_serves_the_relative_ages_it_was_designed_with(tmp_path):
    """The seed freezes mail dates, scan stamps and statistics months at
    build time. Served 90 days later it must look like it did the day it
    was built (last mail "yesterday", this month's statistics, the Wrapped
    year), not 90 days stale: loading shifts the clock back to the build."""
    built = int(time.time()) - 90 * 86400
    env = {**ENV, "DEMO_NOW": str(built)}
    old = tmp_path / "old"
    run_demo("--build-seed", str(old), env=env)
    served = dump(run_demo("--from-seed", str(old), env=env))
    # the process clock reads the build instant (plus the seconds since load)
    assert 0 <= served["clock"] - built < 300
    # the very same demo generated by a process that is itself at that instant
    generated = dump(run_demo(env={**env, "PIN_CLOCK": str(built)}))
    assert scrub(served) == scrub(generated)


CLOCK = r"""
import json, sys, time
sys.path.insert(0, sys.argv[1])
import demo_seed
real = time.time()
out = {}
demo_seed.set_clock(1000.0)
out["shift"] = [time.time(), time.gmtime().tm_year, time.strftime("%Y-%m")]
time.sleep(0.05)
out["runs_on"] = time.time() > 1000.0
out["explicit_arg_untouched"] = time.gmtime(86400 * 366).tm_year
demo_seed.set_clock(2000.0, freeze=True)
a = time.time(); time.sleep(0.05)
out["frozen"] = [a, time.time()]
demo_seed.set_clock(1000.0)                      # again: from the real clock
out["again"] = time.time() < 1100.0
demo_seed.reset_clock()
out["reset"] = abs(time.time() - real) < 60
print(json.dumps(out))
"""


def test_the_clock_shift_and_freeze():
    p = subprocess.run([sys.executable, "-c", CLOCK, str(ROOT / "scripts")],
                       capture_output=True, text=True, timeout=60, check=True)
    out = json.loads(p.stdout)
    assert out["shift"][0] - 1000.0 < 5
    assert out["shift"][1:] == [1970, "1970-01"]
    assert out["runs_on"] and out["again"] and out["reset"]
    assert out["explicit_arg_untouched"] == 1971
    assert out["frozen"] == [2000.0, 2000.0]
