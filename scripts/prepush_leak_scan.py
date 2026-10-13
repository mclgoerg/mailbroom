#!/usr/bin/env python3
"""Local pre-push scan: does anything about to be published contain data from
your own mailbox?

The CI guard (tests/test_no_real_names.py) only sees addresses and real-looking
domains. It cannot see a company named without its domain, a subject line or a
label. This script closes that gap on YOUR machine, with YOUR list of tokens
(company names, domains, addresses, subject fragments, ...). The list never
enters the repository: it is read from the directory named by the
`PRIVATE_DATA_DIR` environment variable.

    PRIVATE_DATA_DIR=~/private/tokens python scripts/prepush_leak_scan.py [--pr N]

Token files in that directory (searched recursively):
  *.txt   one token per line; blank lines and lines starting with `#` ignored
  *.json  every string value anywhere in the document is a token

Matching is a case-insensitive substring test; tokens shorter than
`--min-length` (default 4) are ignored, they would match everything.

What is scanned: the lines added by your branch (`git diff BASE...HEAD`,
BASE defaults to `origin/main`), its commit messages and branch name, and -
with `--pr N` - the title, description and comments of that pull request
(needs the `gh` CLI).

Output: counts and LOCATIONS (file:line, commit, PR part) - never the
surrounding text. The matching tokens are shown only with `--show-tokens`.
Exit code: 0 clean, 1 at least one hit (do not push), 2 could not scan.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Iterator

DEFAULT_BASE = "origin/main"
DEFAULT_MIN_LENGTH = 4


class ScanError(Exception):
    """The scan could not run (no tokens, no git, no gh): exit code 2."""


# ----------------------------------------------------------------- tokens

def _json_strings(node) -> Iterator[str]:
    if isinstance(node, str):
        yield node
    elif isinstance(node, list):
        for item in node:
            yield from _json_strings(item)
    elif isinstance(node, dict):
        for item in node.values():
            yield from _json_strings(item)


def load_tokens(directory: str | Path,
                min_length: int = DEFAULT_MIN_LENGTH) -> list[str]:
    root = Path(directory).expanduser()
    if not root.is_dir():
        raise ScanError("PRIVATE_DATA_DIR is not a directory")
    found: set[str] = set()
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        try:
            if path.suffix == ".txt":
                lines = path.read_text("utf-8").splitlines()
                raw = [ln.strip() for ln in lines
                       if ln.strip() and not ln.lstrip().startswith("#")]
            elif path.suffix == ".json":
                raw = list(_json_strings(json.loads(path.read_text("utf-8"))))
            else:
                continue
        except (OSError, ValueError):
            raise ScanError(f"cannot read the token file {path.name}") from None
        found.update(t.strip().lower() for t in raw
                     if len(t.strip()) >= min_length)
    if not found:
        raise ScanError("no tokens found in PRIVATE_DATA_DIR")
    return sorted(found)


def matches(text: str, tokens: list[str]) -> list[str]:
    low = text.lower()
    return [t for t in tokens if t in low]


# ---------------------------------------------------------------- sources

def _run(args: list[str], cwd: str | None = None) -> str:
    try:
        done = subprocess.run(args, cwd=cwd, capture_output=True, text=True,
                              check=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as exc:
        raise ScanError(f"`{args[0]} {args[1] if len(args) > 1 else ''}` "
                        f"failed ({type(exc).__name__})") from None
    return done.stdout


def added_lines(base: str, cwd: str | None = None) -> Iterator[tuple[str, int, str]]:
    """(path, line number in the new file, text) of every line the branch
    adds relative to BASE (merge-base diff, no context lines)."""
    out = _run(["git", "diff", "--unified=0", "--no-color", "--no-ext-diff",
                f"{base}...HEAD"], cwd)
    path, line = "", 0
    for raw in out.splitlines():
        if raw.startswith("+++ "):
            path = raw[4:].removeprefix("b/")
        elif raw.startswith("@@"):
            # @@ -a,b +c,d @@
            plus = raw.split("+", 1)[1].split(" ", 1)[0]
            line = int(plus.split(",")[0])
        elif raw.startswith("+") and not raw.startswith("+++"):
            yield path, line, raw[1:]
            line += 1


def commit_messages(base: str, cwd: str | None = None) -> Iterator[tuple[str, str]]:
    out = _run(["git", "log", "--format=%H%x00%B%x01", f"{base}..HEAD"], cwd)
    for entry in out.split("\x01"):
        if entry.strip():
            sha, _, body = entry.strip().partition("\x00")
            yield sha[:8], body


def branch_name(cwd: str | None = None) -> str:
    return _run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd).strip()


def pr_texts(number: int, cwd: str | None = None) -> Iterator[tuple[str, str]]:
    """(part, text) of the PR: title, description, every comment and review."""
    out = _run(["gh", "pr", "view", str(number), "--json",
                "title,body,comments,reviews"], cwd)
    data = json.loads(out)
    yield "title", data.get("title") or ""
    yield "description", data.get("body") or ""
    for n, c in enumerate(data.get("comments") or [], 1):
        yield f"comment {n}", c.get("body") or ""
    for n, r in enumerate(data.get("reviews") or [], 1):
        yield f"review {n}", r.get("body") or ""


# ------------------------------------------------------------------- scan

def scan(tokens: list[str], base: str = DEFAULT_BASE, pr: int | None = None,
         cwd: str | None = None) -> list[tuple[str, list[str]]]:
    """[(location, [matching tokens])] - empty when clean."""
    hits: list[tuple[str, list[str]]] = []

    def check(location: str, text: str) -> None:
        found = matches(text, tokens)
        if found:
            hits.append((location, found))

    for path, line, text in added_lines(base, cwd):
        check(f"diff {path}:{line}", text)
    for sha, body in commit_messages(base, cwd):
        check(f"commit {sha}", body)
    check("branch name", branch_name(cwd))
    if pr is not None:
        for part, text in pr_texts(pr, cwd):
            check(f"PR #{pr} {part}", text)
    return hits


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Scan what you are about to publish for your own "
                    "mailbox data (see the module docstring).")
    parser.add_argument("--pr", type=int, help="also scan this pull request's "
                        "title, description and comments (needs `gh`)")
    parser.add_argument("--base", default=DEFAULT_BASE,
                        help=f"compare against this ref (default {DEFAULT_BASE})")
    parser.add_argument("--min-length", type=int, default=DEFAULT_MIN_LENGTH,
                        help="ignore tokens shorter than this (default %(default)s)")
    parser.add_argument("--show-tokens", action="store_true",
                        help="also print the matching tokens")
    args = parser.parse_args(argv)
    try:
        directory = os.environ.get("PRIVATE_DATA_DIR")
        if not directory:
            raise ScanError("set PRIVATE_DATA_DIR to the directory holding "
                            "your token files")
        tokens = load_tokens(directory, args.min_length)
        hits = scan(tokens, args.base, args.pr)
    except ScanError as exc:
        print(f"cannot scan: {exc}", file=sys.stderr)
        return 2
    for location, found in hits:
        shown = f": {', '.join(found)}" if args.show_tokens else ""
        print(f"HIT {location} ({len(found)} token(s)){shown}")
    print(f"scanned against {len(tokens)} tokens: {len(hits)} location(s) hit")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
