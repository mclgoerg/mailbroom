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
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / "scripts" / "demo.py"
# fixed clock: mail dates and scan stamps derive from it
ENV = {**os.environ, "DEMO_NOW": "1790000000", "LOG_LEVEL": "WARNING"}

# Runs demo.py in-process (as a module, so it does not start the server) and
# dumps what the UI reads. A SystemExit is how --build-seed / --from-seed
# finish; the globals survive it.
DRIVER = r"""
import json, sys
path = sys.argv[1]
g = {"__name__": "demo_driver", "__file__": path}
try:
    exec(compile(open(path).read(), path, "exec"), g)
except SystemExit as e:
    if e.code not in (None, 0):
        raise
if "--build-seed" in sys.argv:
    sys.exit(0)
from fastapi.testclient import TestClient
from backend.main import app
c = TestClient(app, base_url="http://localhost")
out = {}
for acct in ("proton", "icloud"):
    out[acct] = {"state": c.get("/api/state", params={"account": acct}).json(),
                 "stats": c.get("/api/stats", params={"account": acct}).json()}
print(json.dumps(out, sort_keys=True))
"""


def run_demo(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-c", DRIVER, str(DEMO), *args], env=ENV,
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
    generated = dump(run_demo())
    served = dump(run_demo("--from-seed", str(seed)))
    assert generated["proton"]["state"]["notice"]            # not vacuous
    assert scrub(served) == scrub(generated)
    assert generated["proton"]["state"]["groups"]["sender"]   # not vacuous


def test_the_seed_layout_and_determinism(seed, tmp_path):
    again = tmp_path / "again"
    run_demo("--build-seed", str(again))
    manifest = json.loads((seed / "seed.json").read_text())
    assert manifest["format"] == 1
    assert "fakes.pkl" in manifest["files"]
    assert any(f.startswith("data/scan_") for f in manifest["files"])
    assert not any("session_secret" in f for f in manifest["files"])
    # the generated mail (and so the pickled servers) is the same every time
    assert (again / "fakes.pkl").read_bytes() == (seed / "fakes.pkl").read_bytes()


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
