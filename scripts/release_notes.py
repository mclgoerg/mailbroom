#!/usr/bin/env python3
"""Release-notes plumbing around release-please (stdlib only).

release-please builds each changelog entry from the squash commit's SUBJECT
(the PR title), so the PR description never reaches the release PR. This
script closes that gap: every user-facing PR carries a "## Release notes"
section in its description; the workflows then

  check            fail a feat/fix/perf PR that has no such section
  enrich-changelog insert each PR's notes under its entry in the newest
                   CHANGELOG.md section (in place)
  enrich-pr N      the same for release PR #N's description (which is what
                   release-please publishes as the GitHub Release notes)

Both enrich commands are idempotent (a marker comment follows every enriched
entry) and only ever add text below an entry. See CONTRIBUTING.md.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from typing import Callable

# PR types that show up in the changelog (release-please's defaults); a
# breaking change of ANY type does too.
NEEDS_NOTES = {"feat", "fix", "perf", "revert"}
SKIP_LABEL = "skip-release-notes"
MAX_CHARS = 1200
MIN_CHARS = 15

_HEADING = re.compile(r"^#{1,6}\s+release notes\s*$", re.IGNORECASE)
_ANY_HEADING = re.compile(r"^#{1,6}\s+\S")
_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
_OVERRIDE = re.compile(r"BEGIN_COMMIT_OVERRIDE.*?(END_COMMIT_OVERRIDE|\Z)",
                       re.DOTALL)
_TITLE = re.compile(r"^(\w+)(?:\([^)]*\))?(!)?:")
# `* subject ([#84](https://…/issues/84)) ([abc1234](https://…))`
_ENTRY = re.compile(r"^\* .*\(\[#(\d+)\]\(")
_MARKER = "<!-- release-notes:{n} -->"


def extract_notes(body: str | None) -> str:
    """The "## Release notes" section of a PR description, cleaned up for
    embedding under a changelog bullet ('' when absent or still empty)."""
    text = (body or "").replace("\r\n", "\n")
    text = _OVERRIDE.sub("", _COMMENT.sub("", text))
    lines = text.split("\n")
    out: list[str] = []
    level = 0                           # heading level of "Release notes"
    for line in lines:
        stripped = line.strip()
        if not level:
            if _HEADING.match(stripped):
                level = len(stripped) - len(stripped.lstrip("#"))
            continue
        if _ANY_HEADING.match(stripped) and not line.startswith(" ") \
                and len(stripped) - len(stripped.lstrip("#")) <= level:
            break                       # next section of the PR description
        out.append(line.rstrip())
    notes = "\n".join(out).strip()
    # Headings inside the notes would split the release PR's sections.
    notes = re.sub(r"(?m)^#{1,6}\s+(.*)$", r"**\1**", notes)
    notes = re.sub(r"\n{3,}", "\n\n", notes)
    if len(notes) > MAX_CHARS:
        cut = notes[:MAX_CHARS].rsplit(None, 1)[0].rstrip(" ,;:-")
        notes = cut + " …"
    return notes


def needs_notes(title: str, labels: list[str] | None = None) -> bool:
    if SKIP_LABEL in (labels or []):
        return False
    m = _TITLE.match(title.strip())
    if not m:
        return False            # the title lint reports this separately
    return m.group(1).lower() in NEEDS_NOTES or bool(m.group(2))


def check(title: str, body: str | None,
          labels: list[str] | None = None) -> str | None:
    """None when fine, else the message to fail the PR check with."""
    if not needs_notes(title, labels):
        return None
    if len(extract_notes(body)) >= MIN_CHARS:
        return None
    return (
        "This PR changes something users see, so release-please will list "
        "it in the changelog - but only by its title. Add a '## Release "
        "notes' section to the PR description: 1-4 plain-language lines on "
        "what changes for the user (and anything to know when upgrading). "
        f"Not user-facing after all? Add the '{SKIP_LABEL}' label.")


def indent(notes: str) -> str:
    return "\n".join(("  " + ln) if ln else "" for ln in notes.split("\n"))


def enrich(markdown: str, fetch_notes: Callable[[int], str]) -> str:
    """Insert each PR's notes under its changelog bullet. A PR that appears
    in several bullets (BEGIN_COMMIT_OVERRIDE) gets its notes under the first
    one only; an already-enriched bullet is left alone."""
    lines = markdown.split("\n")
    out: list[str] = []
    done: set[int] = set()
    for i, line in enumerate(lines):
        out.append(line)
        m = _ENTRY.match(line)
        if not m:
            continue
        n = int(m.group(1))
        marker = "  " + _MARKER.format(n=n)
        if n in done or (i + 1 < len(lines) and lines[i + 1] == marker):
            done.add(n)
            continue
        done.add(n)
        notes = fetch_notes(n)
        if notes:
            out.append(marker)
            out.append(indent(notes))
    return "\n".join(out)


def enrich_newest_section(changelog: str,
                          fetch_notes: Callable[[int], str]) -> str:
    """Only the newest version section: published ones stay untouched."""
    first = changelog.find("\n## [")
    if first < 0:
        return changelog
    second = changelog.find("\n## [", first + 1)
    end = len(changelog) if second < 0 else second
    return (changelog[:first] + enrich(changelog[first:end], fetch_notes)
            + changelog[end:])


# ------------------------------------------------------------------- gh I/O

def _gh(*args: str) -> str:
    return subprocess.run(["gh", *args], check=True, capture_output=True,
                          text=True).stdout


def fetch_pr_notes() -> Callable[[int], str]:
    cache: dict[int, str] = {}

    def fetch(n: int) -> str:
        if n not in cache:
            try:
                cache[n] = extract_notes(
                    _gh("pr", "view", str(n), "--json", "body", "-q", ".body"))
            except subprocess.CalledProcessError as exc:
                print(f"warning: could not read PR #{n}: {exc.stderr}",
                      file=sys.stderr)
                cache[n] = ""
        return cache[n]
    return fetch


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd == "check":
        problem = check(os.environ.get("PR_TITLE", ""),
                        os.environ.get("PR_BODY", ""),
                        json.loads(os.environ.get("PR_LABELS") or "[]"))
        if problem:
            print(f"::error title=Release notes missing::{problem}")
            return 1
        print("release notes: ok (or not required for this PR)")
        return 0
    if cmd == "enrich-changelog" and len(argv) == 3:
        path = argv[2]
        with open(path, encoding="utf-8") as fh:
            old = fh.read()
        new = enrich_newest_section(old, fetch_pr_notes())
        if new != old:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(new)
        print(f"{path}: {'updated' if new != old else 'unchanged'}")
        return 0
    if cmd == "enrich-pr" and len(argv) == 3:
        number = argv[2]
        old = _gh("pr", "view", number, "--json", "body", "-q", ".body")
        old = old.replace("\r\n", "\n")
        new = enrich(old.rstrip("\n"), fetch_pr_notes()) + "\n"
        if new.strip() != old.strip():
            with tempfile.NamedTemporaryFile("w", suffix=".md",
                                             encoding="utf-8") as tmp:
                tmp.write(new)
                tmp.flush()
                _gh("pr", "edit", number, "--body-file", tmp.name)
        print(f"PR #{number}: {'updated' if new.strip() != old.strip() else 'unchanged'}")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
