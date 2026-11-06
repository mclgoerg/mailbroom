"""Persisted demo seed: the build half and the serve half of `demo.py`.

Generating the demo mailboxes, scanning them and building the body index
takes seconds; none of it changes between starts. `demo.py --build-seed DIR`
does it once and writes the result here, `demo.py --from-seed DIR` loads it
and generates nothing.

A seed directory holds:

    seed.json    manifest: format version + sha256 of every other file
    fakes.pkl    the FakeIMAP servers, as they stand after the scans
    runtime.json per-account job state a restart would not restore (the
                 attachment analysis and body index statuses)
    data/        the backend's data dir (config, scan snapshots, body index,
                 verdicts, ...), copied as it stands

The seed is our own trusted artifact (pickle), built and loaded by the same
version of the code. Loading needs no threads and no sockets, and imports
only the standard library.
"""

from __future__ import annotations

import hashlib
import json
import pickle
import shutil
from pathlib import Path

FORMAT = 1
MANIFEST = "seed.json"
FAKES = "fakes.pkl"
RUNTIME = "runtime.json"
DATA = "data"

# Runtime secrets are never part of a seed.
_SKIP = frozenset({"session_secret"})


class SeedError(RuntimeError):
    """The seed directory is missing, corrupted or from another version."""


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*")
                  if p.is_file() and p.name not in _SKIP
                  and p.suffix != ".tmp")


def write(seed_dir: Path | str, data_dir: Path | str, fakes: dict,
          runtime: dict) -> None:
    """Persist `data_dir`, the FakeIMAP servers `fakes` (host -> server) and
    `runtime` (account -> JSON-able state entries) into a fresh
    `seed_dir`."""
    seed, data = Path(seed_dir), Path(data_dir)
    if seed.exists():
        shutil.rmtree(seed)
    (seed / DATA).mkdir(parents=True)
    for src in _files(data):
        dst = seed / DATA / src.relative_to(data)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
    (seed / FAKES).write_bytes(pickle.dumps(fakes, protocol=4))
    (seed / RUNTIME).write_text(json.dumps(runtime, indent=1, sort_keys=True))
    files = {str(p.relative_to(seed)): _sha256(p)
             for p in _files(seed) if p.name != MANIFEST}
    (seed / MANIFEST).write_text(
        json.dumps({"format": FORMAT, "files": files}, indent=1,
                   sort_keys=True) + "\n")


def load(seed_dir: Path | str, data_dir: Path | str) -> tuple[dict, dict]:
    """Copy the seeded data dir into the (empty) `data_dir` and return
    `(fakes, runtime)`: the FakeIMAP servers and the per-account state to
    re-apply. The seed itself is never modified. Raises SeedError with a
    readable message when it cannot be used."""
    seed, data = Path(seed_dir), Path(data_dir)
    try:
        manifest = json.loads((seed / MANIFEST).read_text())
        files = manifest["files"]
        ok = manifest["format"] == FORMAT
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
    return fakes, runtime
