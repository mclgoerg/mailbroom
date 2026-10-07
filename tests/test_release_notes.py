"""scripts/release_notes.py: pulling the "## Release notes" section out of a
PR description, the gate for user-facing PRs, and (idempotent) enrichment of
release-please's changelog entries."""

import importlib.util
import json
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "release_notes",
    Path(__file__).resolve().parent.parent / "scripts" / "release_notes.py")
rn = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(rn)

BODY = """## What
Internal description.

## Release notes
Conversations are now a fourth tab.
- Trash whole old threads at once.

### Upgrading
The first scan after the upgrade is a full rescan.

## Checklist
- [x] tests
"""


# ----------------------------------------------------------- extract_notes

def test_extracts_only_the_release_notes_section():
    notes = rn.extract_notes(BODY)
    assert notes.startswith("Conversations are now a fourth tab.")
    assert "Trash whole old threads" in notes
    assert "Internal description" not in notes
    assert "tests" not in notes                 # stops at the next ## section


def test_subheadings_stay_but_become_bold():
    notes = rn.extract_notes(BODY)
    assert "**Upgrading**" in notes and "### " not in notes
    assert "full rescan" in notes


def test_missing_empty_or_placeholder_sections_give_nothing():
    assert rn.extract_notes(None) == ""
    assert rn.extract_notes("## What\nx") == ""
    assert rn.extract_notes("## Release notes\n\n## Checklist\n- x") == ""
    template = ("## Release notes\n<!-- 1-4 lines for users: what changes -->"
                "\n\n## Checklist")
    assert rn.extract_notes(template) == ""


def test_commit_override_block_and_crlf_are_not_part_of_the_notes():
    body = ("## Release notes\r\nOne line.\r\n\r\nBEGIN_COMMIT_OVERRIDE\r\n"
            "feat: a\r\nfeat: b\r\nEND_COMMIT_OVERRIDE\r\n")
    assert rn.extract_notes(body) == "One line."


def test_heading_match_is_case_insensitive_and_level_agnostic():
    assert rn.extract_notes("### release NOTES\nHello there.") \
        == "Hello there."


def test_long_notes_are_capped_on_a_word_boundary():
    notes = rn.extract_notes("## Release notes\n" + "word " * 1000)
    assert len(notes) <= rn.MAX_CHARS + 2 and notes.endswith(" …")


# ----------------------------------------------------------------- gate

@pytest.mark.parametrize("title", [
    "feat: x", "fix(ui): y", "perf: z", "revert: w", "chore!: breaking",
    "refactor(api)!: breaking"])
def test_user_facing_titles_need_notes(title):
    assert rn.needs_notes(title)
    assert rn.check(title, "## What\nonly") is not None


@pytest.mark.parametrize("title", [
    "chore: x", "docs: y", "ci: z", "test: t", "build(deps): bump a",
    "chore(main): release 1.7.0", "refactor: r", "not conventional"])
def test_other_titles_are_exempt(title):
    assert not rn.needs_notes(title)
    assert rn.check(title, "") is None


def test_skip_label_exempts_and_real_notes_pass():
    assert rn.check("feat: x", "", ["skip-release-notes"]) is None
    assert rn.check("feat: x", BODY) is None
    short = "## Release notes\nok"
    assert rn.check("feat: x", short) is not None       # too thin to count


def test_check_cli_reads_the_environment(monkeypatch, capsys):
    monkeypatch.setenv("PR_TITLE", "fix: x")
    monkeypatch.setenv("PR_BODY", "## What\nnothing")
    monkeypatch.setenv("PR_LABELS", json.dumps([]))
    assert rn.main(["x", "check"]) == 1
    assert "::error" in capsys.readouterr().out
    monkeypatch.setenv("PR_BODY", BODY)
    assert rn.main(["x", "check"]) == 0
    monkeypatch.setenv("PR_BODY", "")
    monkeypatch.setenv("PR_LABELS", json.dumps(["skip-release-notes"]))
    assert rn.main(["x", "check"]) == 0


# --------------------------------------------------------------- enrich

CHANGELOG = """# Changelog

## [1.7.0](https://x/compare/v1.6.0...v1.7.0) (2026-10-06)


### Features

* group mails by conversation thread ([#84](https://x/issues/84)) ([abb945e](https://x/commit/abb945e))
* flat all-mails view ([#83](https://x/issues/83)) ([763f8aa](https://x/commit/763f8aa))


### Bug Fixes

* second line of the same PR ([#84](https://x/issues/84)) ([abb945e](https://x/commit/abb945e))
* no notes for this one ([#79](https://x/issues/79)) ([1e74dce](https://x/commit/1e74dce))

## [1.6.0](https://x/compare/v1.5.1...v1.6.0) (2026-10-02)


### Features

* old entry ([#68](https://x/issues/68)) ([44249c2](https://x/commit/44249c2))
"""

NOTES = {84: "Threads are groups.\n\n- Trash old ones.", 83: "Flat list.",
         68: "SHOULD NOT APPEAR"}


def fetch(n):
    return NOTES.get(n, "")


def test_enrich_adds_notes_under_the_entry_and_indents_them():
    out = rn.enrich_newest_section(CHANGELOG, fetch)
    assert ("* group mails by conversation thread ([#84](https://x/issues/84))"
            " ([abb945e](https://x/commit/abb945e))\n"
            "  <!-- release-notes:84 -->\n"
            "  Threads are groups.\n\n  - Trash old ones.\n") in out
    assert "  <!-- release-notes:83 -->\n  Flat list.\n" in out


def test_notes_attach_to_the_first_bullet_of_a_pr_only():
    out = rn.enrich_newest_section(CHANGELOG, fetch)
    assert out.count("release-notes:84") == 1
    assert out.count("Threads are groups.") == 1


def test_entries_without_notes_and_older_sections_are_untouched():
    out = rn.enrich_newest_section(CHANGELOG, fetch)
    assert "release-notes:79" not in out
    assert "SHOULD NOT APPEAR" not in out
    assert out.endswith(CHANGELOG[CHANGELOG.index("## [1.6.0]"):])


def test_enrichment_is_idempotent():
    once = rn.enrich_newest_section(CHANGELOG, fetch)
    calls = []

    def counting(n):
        calls.append(n)
        return fetch(n)
    twice = rn.enrich_newest_section(once, counting)
    assert twice == once


def test_enrich_works_on_a_release_pr_body():
    body = ":robot: I have created a release *beep* *boop*\n---\n\n" \
        + CHANGELOG.split("\n", 2)[2].split("\n## [1.6.0]")[0] \
        + "\n---\nThis PR was generated with Release Please."
    out = rn.enrich(body, fetch)
    assert "  Flat list." in out
    assert out.rstrip().endswith("generated with Release Please.")
    assert rn.enrich(out, fetch) == out


def test_changelog_without_a_version_section_is_returned_as_is():
    assert rn.enrich_newest_section("# Changelog\n", fetch) == "# Changelog\n"


def test_cli_enrich_changelog_rewrites_the_file(tmp_path, monkeypatch):
    path = tmp_path / "CHANGELOG.md"
    path.write_text(CHANGELOG)
    monkeypatch.setattr(rn, "fetch_pr_notes", lambda: fetch)
    assert rn.main(["x", "enrich-changelog", str(path)]) == 0
    assert "Flat list." in path.read_text()
    before = path.read_text()
    assert rn.main(["x", "enrich-changelog", str(path)]) == 0
    assert path.read_text() == before


def test_cli_enrich_pr_edits_only_when_something_changed(monkeypatch):
    calls = []

    def fake_gh(*args):
        calls.append(args)
        return "* thing ([#83](https://x/issues/83)) ([a](https://x/c))\n" \
            if args[1] == "view" else ""
    monkeypatch.setattr(rn, "_gh", fake_gh)
    monkeypatch.setattr(rn, "fetch_pr_notes", lambda: fetch)
    assert rn.main(["x", "enrich-pr", "78"]) == 0
    assert any(a[:3] == ("pr", "edit", "78") for a in calls)
    calls.clear()
    monkeypatch.setattr(rn, "fetch_pr_notes", lambda: (lambda n: ""))
    assert rn.main(["x", "enrich-pr", "78"]) == 0
    assert not any(a[1] == "edit" for a in calls)


def test_unknown_command_prints_usage(capsys):
    assert rn.main(["x", "bogus"]) == 2
    assert "release-please" in capsys.readouterr().out
