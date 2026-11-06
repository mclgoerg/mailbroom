"""Demo server: Inboxrake on fully fake, in-memory mailboxes.

For screenshots and local poking without any real IMAP server:

    docker run --rm -p 127.0.0.1:8765:8765 \
      -v "$PWD":/repo ghcr.io/mclgoerg/inboxrake:latest \
      python /repo/scripts/demo.py

`--build-seed DIR` generates and scans everything once and writes it to DIR
(see scripts/demo_seed.py); `--from-seed DIR` serves such a seed without
generating anything. `DEMO_NOW` (epoch seconds) pins the clock the mail
dates of a generated demo derive from. A loaded seed shifts the process
clock back to the moment it was built, so its relative ages (last mail
"3 days ago", this month's statistics, the Wrapped year) stay as designed
however old the seed is.

`--empty` starts a fresh install with no account instead (first-run wizard;
any host works, the password "demo" signs in).

The same steps are plain functions for other hosts (the in-browser demo's
Pyodide worker): `build(dir)`, `load(dir)`, `generate()`; importing this
file only isolates the data dir and imports the backend, it runs nothing.

Two demo accounts ("proton", "icloud") with plausible senders, seeded AI
verdicts/ratings and statistics, plus a long tail of small senders so the
Smart tab has something to pool. Everything lives in a temp dir; nothing
touches /data or the network. All addresses use .example domains (the
"Individuals" tail writes from gmail.com / gmx.de / web.de with obviously
fake `demo.person*` local parts - freemail is what makes them individuals).
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT / "scripts"))

# Isolated storage - set BEFORE importing the backend (paths bind at import).
DATA = Path(tempfile.mkdtemp(prefix="inboxrake-demo-"))
os.environ.update(
    CONFIG_PATH=str(DATA / "config.json"),
    STATS_PATH=str(DATA / "ai_usage.json"),
    VERDICTS_PATH=str(DATA / "ai_verdicts.json"),
    AI_SORT_PATH=str(DATA / "ai_sort.json"),
    SENDER_KNOWLEDGE_PATH=str(DATA / "sender_knowledge.json"),
    UNSUB_STATE_PATH=str(DATA / "unsub_state.json"),
    REPLIED_PATH=str(DATA / "replied.json"),
    RULES_PATH=str(DATA / "rules.json"),
    STATS_HISTORY_PATH=str(DATA / "stats_history.json"),
    AUDIT_LOG_PATH=str(DATA / "audit_log.jsonl"),
    SNAPSHOT_DIR=str(DATA),
    SERVER_PATH=str(DATA / "server.json"),
    TENANTS_DIR=str(DATA / "tenants"),
    SESSION_SECRET_PATH=str(DATA / "session_secret"),
    PINS_PATH=str(DATA / "pinned_mails.json"),
    KNOWN_SENDERS_PATH=str(DATA / "known_senders.json"),
    PRESETS_PATH=str(DATA / "presets.json"),
    AUTOSCAN_PATH=str(DATA / "autoscan.json"),
    DIGEST_PATH=str(DATA / "digest.json"),
    IMAP_CAFILE="", IMAP_USER="demo@example.com", IMAP_PASSWORD="demo",
    LOG_LEVEL="INFO",
    # the local body index (Tools -> Trackers) needs a key
    INBOXRAKE_SECRET_KEY="demo-only-secret-key",
)
# When run inside the release image, serve ITS built bundle (the repo
# checkout only has a placeholder static/).
if Path("/app/static/index.html").exists() and "STATIC_DIR" not in os.environ:
    os.environ["STATIC_DIR"] = "/app/static"

# conftest imports pytest only for its fixtures; stub it so the demo can
# reuse FakeIMAP without installing test dependencies.
import types                                     # noqa: E402


def _fixture(*a, **k):
    return a[0] if a and callable(a[0]) else (lambda f: f)


sys.modules.setdefault("pytest", types.SimpleNamespace(fixture=_fixture))

from conftest import FakeIMAP, make_msg          # noqa: E402
from backend import accounts, aihelper, demo, mailops, rules      # noqa: E402




def _run_empty() -> None:
    """`--empty`: a fresh install with NO account set up (for the first-run
    wizard). Any host is accepted; the password "demo" signs in, anything
    else is refused like a real server would, and the one mailbox behind it
    is small."""
    import imaplib
    import uvicorn
    from backend.main import app
    inbox = [make_msg(i, frm=f'"Shop {i % 4}" <news{i % 4}@shop.example>',
                      subject=f"Offer {i}") for i in range(1, 25)]
    box = FakeIMAP({"INBOX": inbox, "Sent": [], "Trash": [], "Drafts": []})

    def connect(im, name=None):
        if not im.get("host") or not im.get("user") or not im.get("password"):
            raise RuntimeError(mailops.coded(mailops.NO_ACCOUNT))
        if im["password"] != "demo":
            raise imaplib.IMAP4.error("[AUTHENTICATIONFAILED] Invalid "
                                      "credentials")
        return box
    mailops.connect = connect
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("DEMO_PORT", "8765")), log_level="warning")



_FILTER_ANSWERS = [
    (("never read", "nie lese"),
     {"query": "tag:newsletter unread:>90 age:>1y", "unsupported": [],
      "explanation": "Newsletters, which you hardly ever open, with no mail "
                     "for over a year."}),
    (("shipping", "versand"),
     {"query": "tag:shipping ai:safe", "unsupported": [],
      "explanation": "Shipping notifications the AI rated safe to delete."}),
    (("never answered", "nie geantwortet"),
     {"query": "att:>5m is:noreply-ever",
      "unsupported": ["only mails from last week"],
      "explanation": "Senders with large attachments that you never wrote "
                     "to."}),
]
_FILTER_ANSWERS_DE = {
    "tag:newsletter unread:>90 age:>1y":
        "Newsletter, die Sie kaum öffnen, ohne Mail seit über einem Jahr.",
    "tag:shipping ai:safe":
        "Versandmeldungen, die die KI als harmlos einstuft.",
    "att:>5m is:noreply-ever":
        "Absender mit großen Anhängen, denen Sie nie geschrieben haben.",
}


_real_ai_client = aihelper.ai_client


def _demo_ai_client(cfg):

    def create(**kw):
        ask = json.loads(kw["messages"][0]["content"])
        if "sentence" not in ask:            # not a filter request
            return _real_ai_client(cfg).messages.create(**kw)
        sentence = ask["sentence"].lower()
        out = {"query": "", "unsupported": [ask["sentence"][:80]],
               "explanation": "The demo AI only knows three example "
                              "sentences."}
        for needles, answer in _FILTER_ANSWERS:
            if any(n in sentence for n in needles):
                out = dict(answer)
                if ask["language"] == "German":
                    out["explanation"] = _FILTER_ANSWERS_DE[out["query"]]
                    out["unsupported"] = [u.replace(
                        "only mails from last week", "nur Mails der letzten Woche")
                        for u in out["unsupported"]]
        return types.SimpleNamespace(
            stop_reason="end_turn",
            content=[types.SimpleNamespace(type="text",
                                           text=json.dumps(out))],
            usage=types.SimpleNamespace(input_tokens=900, output_tokens=80))
    return types.SimpleNamespace(messages=types.SimpleNamespace(create=create))



def _install_ai() -> None:
    aihelper.ai_client = _demo_ai_client


def _serve() -> None:
    import uvicorn
    from backend.main import app
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("DEMO_PORT", "8765")), log_level="warning")


class DemoError(RuntimeError):
    """The demo could not start (a bad seed, ...); the text says why."""


def generate() -> dict:
    """Generate and scan the demo mailboxes into the data dir; returns the
    FakeIMAP servers by host."""
    _install_ai()
    import demo_generate
    return demo_generate.generate()


def _reproducible_generate():
    """`generate()` for a seed that is byte-for-byte the same on every build
    when `DEMO_NOW` pins the instant: the clock stands still at it (every
    scan / rule / audit stamp is that instant) and the random bytes the
    backend draws (rule ids, the body index salt) come from a fixed
    generator. Everything is back to normal afterwards."""
    import demo_seed
    if not os.environ.get("DEMO_NOW"):
        return generate()
    import random
    rng, urandom = random.Random(7), os.urandom
    os.urandom = lambda n: rng.randbytes(n)
    demo_seed.set_clock(float(os.environ["DEMO_NOW"]), freeze=True)
    try:
        return generate()
    finally:
        demo_seed.reset_clock()
        os.urandom = urandom


def build(seed_dir) -> None:
    """Generate everything once and persist it as a seed in `seed_dir`."""
    import demo_seed
    fakes = _reproducible_generate()
    import demo_generate
    try:
        demo_seed.write(seed_dir, DATA, fakes, {
            n: {k: accounts.get(n).state[k]
                for k in ("atts", "index", "notice")
                if k in accounts.get(n).state}
            for n in ("proton", "icloud")}, built_at=demo_generate.NOW)
    except demo_seed.SeedError as e:
        raise DemoError(str(e)) from None
    print(f"[demo] seed written to {seed_dir}")


def _forget_the_last_visitor() -> None:
    """What a "Reset demo" must not keep: files the seed does not have
    (pins, known senders, ...) and the stores' in-memory copies of them."""
    import shutil
    from backend import pinstore, unsubstore, verdictstore
    for p in DATA.iterdir():
        if p.name == "session_secret":
            continue
        shutil.rmtree(p) if p.is_dir() else p.unlink()
    pinstore._cache.clear()
    unsubstore._cache.clear()
    verdictstore._mails_cache.clear()


def load(seed_dir) -> dict:
    """Serve the seed in `seed_dir`: nothing is generated or scanned. Also
    moves the clock to the seed's build time (see demo_seed.set_clock), so
    call it before anything reads the time. Returns the FakeIMAP servers by
    host; safe to call again (a reset)."""
    import demo_seed
    _install_ai()
    _forget_the_last_visitor()
    try:
        seed = demo_seed.load(seed_dir, DATA)
    except demo_seed.SeedError as e:
        raise DemoError(str(e)) from None
    demo_seed.set_clock(seed.built_at)
    accounts.reset()          # a reset: forget what the last visitor did

    def connect(im, name=None):
        if im.get("host") not in seed.fakes:
            raise demo.refusal()  # "Add account" with a real server
        return seed.fakes[im["host"]]
    mailops.connect = connect
    for name in accounts.names():
        acc = accounts.get(name)
        # the Gmail demo accounts are never scanned: no snapshot, no error
        if not mailops.load_snapshot(acc) and name in seed.runtime:
            raise DemoError(f"the scan snapshot of {name!r} in the seed is "
                            "unusable; rebuild it with --build-seed")
        acc.state.update(seed.runtime.get(name, {}))
    rules.publish()          # the lifespan does this too; it is idempotent
    return seed.fakes


def _flag(argv: list[str], name: str) -> str | None:
    """The value after `--name` in `argv`, if given."""
    if name in argv:
        try:
            return argv[argv.index(name) + 1]
        except IndexError:
            raise DemoError(f"{name} needs a directory") from None
    return None


def main(argv: list[str], *, serve: bool = True) -> None:
    """The command line: `--empty`, `--build-seed DIR`, `--from-seed DIR`, or
    nothing (generate and serve). `serve=False` stops short of the server."""
    try:
        if "--empty" in argv:
            os.environ.update(IMAP_USER="", IMAP_PASSWORD="")
            from backend import config as _cfg
            _cfg.ENV_IMAP["user"] = _cfg.ENV_IMAP["password"] = ""
            _cfg.DEFAULT_CONFIG["accounts"]["default"].update(user="", password="")
            if serve:
                _run_empty()
        elif (seed := _flag(argv, "--build-seed")):
            build(seed)
        elif (seed := _flag(argv, "--from-seed")):
            load(seed)
            if serve:
                _serve()
        else:
            generate()
            if serve:
                _serve()
    except DemoError as e:
        raise SystemExit(f"demo: {e}") from None


if __name__ == "__main__":
    main(sys.argv[1:])
