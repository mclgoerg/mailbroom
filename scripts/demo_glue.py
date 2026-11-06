"""The Python half of the in-browser demo (Pyodide worker).

The worker unpacks the bundle's app zip to /app and the seed zip to
/app/seed, puts /app/scripts on `sys.path`, then:

    import demo_glue
    demo_glue.boot()                       # a few seconds, once
    await demo_glue.request(method, path, query, body, headers)

`boot()` isolates the data dir, installs the backend's demo hooks (no
threads, no sockets, stand-in Fernet, `anthropic` stub - backend/demo.py)
and serves the pre-built seed: nothing is generated or scanned. It is safe
to call again for a "Reset demo". Never imported by the app itself.
"""

from __future__ import annotations

import logging
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "seed"


def boot(seed_dir: Path | str = SEED) -> dict:
    """Start the backend on the seed in `seed_dir`; returns the milliseconds
    each stage took."""
    marks: dict[str, int] = {}
    t0 = time.perf_counter()

    def mark(stage: str) -> None:
        marks[stage] = round((time.perf_counter() - t0) * 1000)

    for p in (ROOT / "scripts", ROOT / "tests", ROOT):
        if str(p) not in sys.path:
            sys.path.insert(0, str(p))
    import demo as demo_script            # scripts/demo.py: data dir + env first
    from backend import demo as hooks
    mark("imports")
    hooks.install()
    mark("hooks")
    demo_script.load(seed_dir)
    mark("seed")
    from backend.main import app          # noqa: F401 - the routes, once
    logging.getLogger().setLevel(logging.WARNING)
    mark("app")
    return marks


async def request(method: str, path: str, query: str = "", body=None,
                  headers: dict[str, str] | None = None) -> dict:
    """One in-process HTTP call: backend.demo.request."""
    from backend import demo as hooks
    return await hooks.request(method, path, query, body, headers)
