"""scripts/prepush_leak_scan.py: the maintainer's local scan for their own
mailbox data. The tokens here are invented words; the real list lives
outside the repository (PRIVATE_DATA_DIR)."""

from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "prepush_leak_scan.py"
spec = importlib.util.spec_from_file_location("prepush_leak_scan", SCRIPT)
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)

NEEDS_GIT = pytest.mark.skipif(shutil.which("git") is None, reason="needs git")

TOKEN = "zorblax"                      # an invented word
OTHER = "quuxnorth"


@pytest.fixture
def tokens_dir(tmp_path):
    d = tmp_path / "private"
    d.mkdir()
    (d / "words.txt").write_text(
        f"# a comment\n\n{TOKEN}\nab\n  Spaced Phrase  \n", "utf-8")
    (d / "nested").mkdir()
    (d / "nested" / "more.json").write_text(
        json.dumps({"list": [OTHER, 5, None], "deep": {"x": ["Deep Token"]}}),
        "utf-8")
    (d / "ignored.csv").write_text("csvtoken\n", "utf-8")
    return d


def test_tokens_come_from_txt_and_json_lowercased_and_length_limited(tokens_dir):
    tokens = scanner.load_tokens(tokens_dir)
    assert set(tokens) == {TOKEN, OTHER, "spaced phrase", "deep token"}
    assert "ab" not in tokens and "csvtoken" not in tokens
    assert "ab" in scanner.load_tokens(tokens_dir, min_length=2)


@pytest.mark.parametrize("make", ["missing", "empty", "unreadable_json"])
def test_no_usable_tokens_is_an_error_not_a_clean_scan(tmp_path, make):
    d = tmp_path / "d"
    if make != "missing":
        d.mkdir()
    if make == "unreadable_json":
        (d / "x.json").write_text("{not json", "utf-8")
    with pytest.raises(scanner.ScanError):
        scanner.load_tokens(d)


def test_matching_is_a_case_insensitive_substring_test():
    assert scanner.matches(f"Hello {TOKEN.upper()}s", [TOKEN]) == [TOKEN]
    assert scanner.matches("nothing here", [TOKEN]) == []


# --------------------------------------------------- against a real git repo

def git(repo, *args):
    subprocess.run(["git", "-C", str(repo), "-c", "user.name=t",
                    "-c", "user.email=t@t.example", "-c", "commit.gpgsign=false",
                    *args], check=True, capture_output=True)


@pytest.fixture
def repo(tmp_path):
    r = tmp_path / "repo"
    r.mkdir()
    git(r, "init", "-q", "-b", "main")
    (r / "base.txt").write_text(f"main already says {TOKEN}\nline two\n")
    git(r, "add", ".")
    git(r, "commit", "-q", "-m", "base")
    git(r, "checkout", "-q", "-b", "feature/x")
    return r


def commit(repo, name, text, message="change"):
    (repo / name).write_text(text)
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", message)


def run_scan(repo, tokens_dir, monkeypatch, *args):
    monkeypatch.chdir(repo)
    monkeypatch.setenv("PRIVATE_DATA_DIR", str(tokens_dir))
    return scanner.main(["--base", "main", *args])


@NEEDS_GIT
def test_clean_branch_exits_zero(repo, tokens_dir, monkeypatch, capsys):
    commit(repo, "new.txt", "all good\n")
    assert run_scan(repo, tokens_dir, monkeypatch) == 0
    assert "0 location(s) hit" in capsys.readouterr().out


@NEEDS_GIT
def test_an_added_line_is_a_hit_with_file_and_line_but_not_the_token(
        repo, tokens_dir, monkeypatch, capsys):
    commit(repo, "new.txt", f"fine\nthe {TOKEN.upper()} line\n")
    assert run_scan(repo, tokens_dir, monkeypatch) == 1
    out = capsys.readouterr().out
    assert "HIT diff new.txt:2" in out
    assert TOKEN not in out.lower()


@NEEDS_GIT
def test_show_tokens_prints_what_matched(repo, tokens_dir, monkeypatch, capsys):
    commit(repo, "new.txt", f"{OTHER}\n")
    assert run_scan(repo, tokens_dir, monkeypatch, "--show-tokens") == 1
    assert OTHER in capsys.readouterr().out


@NEEDS_GIT
def test_only_lines_the_branch_adds_are_scanned(repo, tokens_dir, monkeypatch):
    # main already has a line with the token; the branch edits another line
    commit(repo, "base.txt", f"main already says {TOKEN}\nline 2\n")
    assert run_scan(repo, tokens_dir, monkeypatch) == 0
    commit(repo, "base.txt", f"main still says {TOKEN}\nline 2\n")   # re-added
    assert run_scan(repo, tokens_dir, monkeypatch) == 1
    commit(repo, "base.txt", "line 2\n")                   # removed again
    assert run_scan(repo, tokens_dir, monkeypatch) == 0


@NEEDS_GIT
def test_a_commit_message_is_scanned(repo, tokens_dir, monkeypatch, capsys):
    commit(repo, "new.txt", "fine\n", message=f"mention {OTHER} here")
    assert run_scan(repo, tokens_dir, monkeypatch) == 1
    assert "HIT commit" in capsys.readouterr().out


@NEEDS_GIT
def test_the_branch_name_is_scanned(repo, tokens_dir, monkeypatch, capsys):
    git(repo, "checkout", "-q", "-b", f"feature/{TOKEN}-fix")
    commit(repo, "new.txt", "fine\n")
    assert run_scan(repo, tokens_dir, monkeypatch) == 1
    assert "HIT branch name" in capsys.readouterr().out


@NEEDS_GIT
def test_pr_text_is_scanned(repo, tokens_dir, monkeypatch, capsys):
    commit(repo, "new.txt", "fine\n")
    page = {"title": "feat: fine", "body": f"## Summary\n{TOKEN}\n",
            "comments": [{"body": "ok"}, {"body": f"and {OTHER}"}],
            "reviews": [{"body": ""}]}
    inline = [{"body": "fine"}, {"body": f"inline {TOKEN}"}]

    def fake_run(args, cwd=None):
        if args[:2] == ["gh", "pr"]:
            return json.dumps(page)
        if args[0] == "gh":
            return json.dumps(inline)
        return subprocess.run(args, cwd=cwd, capture_output=True, text=True,
                              check=True).stdout
    monkeypatch.setattr(scanner, "_run", fake_run)
    assert run_scan(repo, tokens_dir, monkeypatch, "--pr", "7") == 1
    out = capsys.readouterr().out
    assert "HIT PR #7 description" in out and "HIT PR #7 comment 2" in out
    assert "HIT PR #7 inline comment 2" in out
    assert "title" not in out and "review 1" not in out


@NEEDS_GIT
def test_added_file_names_are_scanned(repo, tokens_dir, monkeypatch, capsys):
    commit(repo, f"{TOKEN}.txt", "fine\n")
    assert run_scan(repo, tokens_dir, monkeypatch) == 1
    assert "HIT file name" in capsys.readouterr().out


@NEEDS_GIT
def test_a_line_that_looks_like_a_diff_header_is_still_a_line(
        repo, tokens_dir, monkeypatch, capsys):
    commit(repo, "new.txt", f"++ {TOKEN}\n")      # the diff shows "+++ ..."
    assert run_scan(repo, tokens_dir, monkeypatch) == 1
    assert "HIT diff new.txt:1" in capsys.readouterr().out


def test_missing_private_data_dir_exits_two(monkeypatch, capsys):
    monkeypatch.delenv("PRIVATE_DATA_DIR", raising=False)
    assert scanner.main([]) == 2
    assert "PRIVATE_DATA_DIR" in capsys.readouterr().err


@NEEDS_GIT
def test_not_a_git_repository_exits_two(tmp_path, tokens_dir, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("PRIVATE_DATA_DIR", str(tokens_dir))
    monkeypatch.setenv("GIT_CEILING_DIRECTORIES", str(tmp_path.parent))
    assert scanner.main(["--base", "main"]) == 2
