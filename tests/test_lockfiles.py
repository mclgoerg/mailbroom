"""The dev lockfile must not drift from the runtime one: CI tests what the
image ships only if every package pinned in both files has the same pin."""
import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
PIN = re.compile(r"^([A-Za-z0-9._-]+)==(\S+?)\s*(?:\\|;|$)", re.M)


def _pins(name: str) -> dict[str, str]:
    text = (BACKEND / name).read_text()
    return {n.lower().replace("_", "-"): v for n, v in PIN.findall(text)}


def test_lockfiles_are_pinned():
    assert len(_pins("requirements.txt")) > 10
    assert len(_pins("requirements-dev.txt")) > len(_pins("requirements.txt"))


def test_dev_lock_matches_runtime_lock():
    runtime, dev = _pins("requirements.txt"), _pins("requirements-dev.txt")
    missing = sorted(set(runtime) - set(dev))
    differing = sorted(n for n in runtime if n in dev and dev[n] != runtime[n])
    assert not missing, f"runtime pins absent from the dev lock: {missing}"
    assert not differing, (
        "dev lock drifts from requirements.txt: "
        + ", ".join(f"{n} {runtime[n]} != {dev[n]}" for n in differing)
    )
