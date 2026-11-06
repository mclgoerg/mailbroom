"""Every backend logger lives under the project's `inboxrake.` namespace
(log filters key on it); uvicorn's own loggers are the only exception."""
import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
NAME = re.compile(r"""getLogger\(\s*["']([^"']+)["']""")


def test_backend_loggers_use_the_project_namespace():
    seen = []
    for f in sorted(BACKEND.glob("*.py")):
        for name in NAME.findall(f.read_text()):
            seen.append((f.name, name))
    assert seen
    bad = [(f, n) for f, n in seen
           if not n.startswith(("inboxrake.", "uvicorn"))]
    assert not bad, bad
