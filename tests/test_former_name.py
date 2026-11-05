"""The rename from Mailbroom to Inboxrake: settings under the former name
keep working (with a rename hint), and apart from a "formerly Mailbroom"
note the former name comes back nowhere else."""

import logging
import os
import subprocess
import sys

from test_no_real_names import ROOT, tracked_files

from backend import adopt_former_env, main

# The only files that may still say "Mailbroom", and why (plus lines that
# say "formerly Mailbroom" anywhere).
FORMER_NAME_ALLOWED = {
    "CHANGELOG.md": "release history before the rename",
    "backend/__init__.py": "reads MAILBROOM_* settings",
    "backend/main.py": "rename hint for MAILBROOM_* settings",
    "tests/test_former_name.py": "this file",
}


def test_former_name_appears_only_where_intended():
    found = []
    for rel in tracked_files(ROOT):
        # Seen without git only: a worktree's `.git` file holds the checkout
        # path, Hypothesis caches constants of the source.
        if (rel in FORMER_NAME_ALLOWED
                or rel.split("/")[0] in (".git", ".hypothesis")):
            continue
        try:
            text = (ROOT / rel).read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        found += [f"{rel}:{n}" for n, line in enumerate(text.splitlines(), 1)
                  if "mailbroom" in line.lower()
                  and "formerly mailbroom" not in line.lower()]
    assert not found, ("the project is called Inboxrake now: "
                       + ", ".join(found))


def test_former_env_fills_in_only_unset_names():
    env = {"MAILBROOM_SECRET_KEY": "old-key", "MAILBROOM_MS_TENANT": "old",
           "INBOXRAKE_MS_TENANT": "new", "OTHER": "x"}
    assert adopt_former_env(env) == ["MAILBROOM_MS_TENANT",
                                     "MAILBROOM_SECRET_KEY"]
    assert env["INBOXRAKE_SECRET_KEY"] == "old-key"
    assert env["INBOXRAKE_MS_TENANT"] == "new"


def test_a_process_with_only_former_names_uses_them():
    # Adopted at package import, before modules that read env at import.
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("INBOXRAKE_", "MAILBROOM_"))}
    env.update(MAILBROOM_SECRET_KEY="made-up", MAILBROOM_MS_TENANT="common")
    out = subprocess.run(
        [sys.executable, "-c", "from backend import oauthflow, secretbox; "
         "print(secretbox.enabled(), oauthflow.MS_TENANT)"],
        cwd=ROOT, env=env, capture_output=True, text=True, timeout=60)
    assert out.stdout.split() == ["True", "common"], out.stderr


def test_former_env_gets_a_rename_hint(monkeypatch, caplog):
    monkeypatch.setattr(main, "FORMER_ENV",
                        ["MAILBROOM_MS_TENANT", "MAILBROOM_SECRET_KEY"])
    monkeypatch.setenv("MAILBROOM_SECRET_KEY", "made-up")
    monkeypatch.setenv("INBOXRAKE_SECRET_KEY", "made-up")
    monkeypatch.setenv("MAILBROOM_MS_TENANT", "old")
    monkeypatch.setenv("INBOXRAKE_MS_TENANT", "new")
    with caplog.at_level(logging.WARNING, logger="pmc.config"):
        main._log_former_env()
    assert caplog.messages == [
        "MAILBROOM_MS_TENANT is ignored - INBOXRAKE_MS_TENANT is set",
        "MAILBROOM_SECRET_KEY still works but is the former name - rename "
        "it to INBOXRAKE_SECRET_KEY"]
