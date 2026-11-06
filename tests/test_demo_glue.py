"""`scripts/demo_glue.py`: what the in-browser demo's worker calls. A
subprocess per run (boot installs the demo hooks and moves the clock for the
whole process)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
BUILT = int(time.time()) - 90 * 86400            # a seed three months old
ENV = {**os.environ, "DEMO_NOW": str(BUILT), "LOG_LEVEL": "WARNING"}
DEMO = ROOT / "scripts" / "demo.py"

WORKER = r"""
import asyncio, json, sys, time
sys.path.insert(0, sys.argv[1] + "/scripts")
import demo_glue
marks = demo_glue.boot(sys.argv[2])
import os
from backend import mailops
refused = ""
try:
    mailops.connect({"host": "imap.other.example"})
except Exception as e:
    refused = str(e)

async def pin():
    r = await demo_glue.request("POST", "/api/pin", "account=proton",
                                {"folder": "INBOX", "uid": 1})
    return r["status"], os.path.exists(os.environ["PINS_PATH"]), \
        os.environ["PINS_PATH"]

pinned = asyncio.run(pin())
demo_glue.boot(sys.argv[2])                           # "Reset demo"
from backend import pinstore
left = (os.path.exists(os.environ["PINS_PATH"]),
        sorted(pinstore.load_account("proton")))

async def go():
    out = {}
    for name, (method, path, query, body) in {
        "state": ("GET", "/api/state", "account=proton", None),
        "auth": ("GET", "/api/auth", "", None),
        "trash": ("POST", "/api/delete", "account=proton",
                  {"grouping": "sender", "keys": [sys.argv[3]]}),
        "after": ("GET", "/api/state", "account=proton", None),
        "undo": ("POST", "/api/undo", "account=proton", {}),
        "back": ("GET", "/api/state", "account=proton", None),
    }.items():
        r = await demo_glue.request(method, path, query, body)
        out[name] = [r["status"], json.loads(r["body"])]
    return out

out = asyncio.run(go())
out["marks"] = sorted(marks)
out["refused"], out["pinned"], out["left"] = refused, pinned, left
out["clock"] = time.time()
print(json.dumps(out))
"""


@pytest.fixture(scope="module")
def seed(tmp_path_factory) -> Path:
    path = tmp_path_factory.mktemp("glue") / "seed"
    subprocess.run([sys.executable, str(DEMO), "--build-seed", str(path)],
                   env=ENV, check=True, capture_output=True, timeout=300)
    return path


def test_boot_serves_the_seed_and_trash_and_undo_work(seed):
    key = "news@acme-store.example"
    p = subprocess.run(
        [sys.executable, "-c", WORKER, str(ROOT), str(seed), key],
        env=ENV, capture_output=True, text=True, timeout=300)
    assert p.returncode == 0, p.stderr[-2000:]
    out = json.loads(p.stdout.strip().splitlines()[-1])
    assert out["marks"] == ["app", "hooks", "imports", "seed"]
    assert out["state"][0] == 200 and out["auth"][0] == 200
    assert key in out["state"][1]["groups"]["sender"]
    assert out["trash"][0] == 200
    assert key not in out["after"][1]["groups"]["sender"]
    assert out["undo"][0] == 200
    assert key in out["back"][1]["groups"]["sender"]
    assert "not_in_demo" in out["refused"]        # not a raw KeyError
    assert out["pinned"][:2] == [200, True]       # in the demo's own data dir
    assert not out["pinned"][2].startswith("/data")
    assert out["left"] == [False, []]             # a reset forgets the pin
    # the 90 day old seed runs on its own build day (see demo_seed.set_clock)
    assert 0 <= out["clock"] - BUILT < 600
