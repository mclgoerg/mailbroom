"""Persisted demo seed: the build half and the serve half of `demo.py`.

Generating the demo mailboxes, scanning them and building the body index
takes seconds; none of it changes between starts. `demo.py --build-seed DIR`
does it once and writes the result here, `demo.py --from-seed DIR` loads it
and generates nothing.

A seed directory holds:

    seed.json    manifest: format version, the instant the mail dates
                 derive from (`built_at`) + sha256 of every other file
    fakes.pkl    the FakeIMAP servers, as they stand after the scans
    runtime.json per-account state a restart would not restore (the
                 attachment analysis and body index statuses, the notice)
    data/        the backend's data dir (config, scan snapshots, body index,
                 verdicts, ...), copied as it stands

A seed freezes its mail dates, scan stamps and statistics months at build
time. `set_clock(built_at)` shifts the process clock back to that instant on
load, so a seed deployed for months still shows the relative ages it was
designed with.

The seed is our own trusted artifact (pickle), built and loaded by the same
version of the code. Loading needs no threads and no sockets, and imports
only the standard library.
"""

from __future__ import annotations

import hashlib
import json
import pickle
import shutil
import sqlite3
import time
from typing import NamedTuple
from pathlib import Path

FORMAT = 2
MANIFEST = "seed.json"
FAKES = "fakes.pkl"
RUNTIME = "runtime.json"
DATA = "data"

# Runtime secrets are never part of a seed.
_SKIP = frozenset({"session_secret"})


class SeedError(RuntimeError):
    """The seed directory is missing, corrupted or from another version."""


class Seed(NamedTuple):
    fakes: dict          # host -> FakeIMAP server
    runtime: dict        # account -> state entries to re-apply
    built_at: float      # the instant the seed's mail dates derive from


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*")
                  if p.is_file() and p.name not in _SKIP
                  and p.suffix != ".tmp")


def _copy_db(src: Path, dst: Path) -> None:
    """Copy a SQLite file in its canonical form: the raw file carries page
    and change-counter details that differ between two otherwise identical
    builds (and any WAL content is folded in)."""
    conn = sqlite3.connect(src)
    try:
        conn.execute("VACUUM INTO ?", (str(dst),))
    finally:
        conn.close()


def write(seed_dir: Path | str, data_dir: Path | str, fakes: dict,
          runtime: dict, *, built_at: float) -> None:
    """Persist `data_dir`, the FakeIMAP servers `fakes` (host -> server) and
    `runtime` (account -> JSON-able state entries) into a fresh `seed_dir`.
    `built_at` is the epoch second the generated mail dates derive from."""
    seed, data = Path(seed_dir), Path(data_dir)
    if seed.exists():
        # only ever replace an earlier seed; never wipe an arbitrary directory
        if not seed.is_dir() or (any(seed.iterdir())
                                 and not (seed / MANIFEST).is_file()):
            raise SeedError(f"{seed} exists and is not a demo seed; give "
                            "--build-seed a new or empty directory")
        shutil.rmtree(seed)
    (seed / DATA).mkdir(parents=True)
    for src in _files(data):
        dst = seed / DATA / src.relative_to(data)
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.suffix == ".db":
            _copy_db(src, dst)
        else:
            shutil.copyfile(src, dst)
    (seed / FAKES).write_bytes(pickle.dumps(fakes, protocol=4))
    (seed / RUNTIME).write_text(json.dumps(runtime, indent=1, sort_keys=True))
    files = {str(p.relative_to(seed)): _sha256(p)
             for p in _files(seed) if p.name != MANIFEST}
    (seed / MANIFEST).write_text(
        json.dumps({"format": FORMAT, "built_at": built_at, "files": files}, indent=1,
                   sort_keys=True) + "\n")


def load(seed_dir: Path | str, data_dir: Path | str) -> Seed:
    """Copy the seeded data dir into the (empty) `data_dir` and return the
    `Seed`: the FakeIMAP servers, the per-account state to re-apply and the
    build instant. The seed itself is never modified. Raises SeedError with a
    readable message when it cannot be used."""
    seed, data = Path(seed_dir), Path(data_dir)
    try:
        manifest = json.loads((seed / MANIFEST).read_text())
        files = manifest["files"]
        ok = manifest["format"] == FORMAT
        built_at = float(manifest["built_at"]) if ok else 0.0
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise SeedError(
            f"no usable demo seed in {seed} ({type(e).__name__}); build "
            f"one with `demo.py --build-seed {seed}`") from e
    if not ok:
        raise SeedError(f"the demo seed in {seed} has format "
                        f"{manifest['format']!r}, this code reads {FORMAT}; "
                        "rebuild it with --build-seed")
    for rel, digest in files.items():
        try:
            if _sha256(seed / rel) != digest:
                raise SeedError(f"the demo seed in {seed} is corrupted "
                                f"({rel} changed); rebuild it with "
                                "--build-seed")
        except OSError as e:
            raise SeedError(f"the demo seed in {seed} is incomplete "
                            f"({rel} is unreadable); rebuild it with "
                            "--build-seed") from e
    for rel in (FAKES, RUNTIME):
        if rel not in files:
            raise SeedError(f"the demo seed in {seed} has no {rel}; "
                            "rebuild it with --build-seed")
    try:
        runtime = json.loads((seed / RUNTIME).read_text())
        fakes = pickle.loads((seed / FAKES).read_bytes())
    except Exception as e:            # noqa: BLE001 - anything a bad pickle raises
        raise SeedError(
            f"the demo seed in {seed} was built by different code "
            f"({type(e).__name__}: {e}); rebuild it with --build-seed"
        ) from e
    for rel in files:
        if rel.startswith(DATA + "/"):
            dst = data / Path(rel).relative_to(DATA)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(seed / rel, dst)
    return Seed(fakes, runtime, built_at)


# ----------------------------------------------------------------- clock

_real: dict = {}
_pin: tuple[float, bool] | None = None   # (instant "now" reads, frozen?)
_pin_since = 0.0                         # the real time it was pinned


def _now() -> float:
    if _pin is None:
        return _real["time"]()
    at, frozen = _pin
    return at if frozen else at + _real["time"]() - _pin_since


def _shifted(name: str):
    original = _real[name]

    def call(t=None):
        return original(_now() if t is None else t)
    call.__name__ = name
    return call


def _strftime(fmt, t=None):
    return _real["strftime"](fmt, time.localtime() if t is None else t)


def set_clock(at: float, *, freeze: bool = False) -> None:
    """Make "now" read `at`: `time.time()` and the no-argument `localtime()`
    / `gmtime()` / `strftime()` the backend uses for ages, statistics months
    and the Wrapped year. By default a shift (the clock runs on from `at`;
    a clock that stands still would hang timeouts), so a seed built on
    some day keeps its relative ages whenever it is served. `freeze=True`
    stands still: building a seed that is byte-for-byte reproducible.
    Safe to call again (a reset): it always works from the real clock."""
    global _pin, _pin_since
    if not _real:
        for name in ("time", "localtime", "gmtime", "strftime"):
            _real[name] = getattr(time, name)
        time.time = _now
        time.localtime = _shifted("localtime")
        time.gmtime = _shifted("gmtime")
        time.strftime = _strftime
    _pin, _pin_since = (at, freeze), _real["time"]()


def reset_clock() -> None:
    """The real clock again."""
    global _pin
    _pin = None
