"""The errors of the folder features are stable codes the UI words in the
user's language (mailops.coded / FOLDER_ERROR_CODES, frontend/src/api.ts
ERROR_CODES): the convention itself, the lists on both sides agreeing, the
refusals that no other test pins, and the undo labels the UI words itself."""

import re
from pathlib import Path
from urllib.parse import unquote

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import aifilter
from backend import auditlog
from backend import errortext
from backend import knowledgestore
from backend import mailops
from backend.main import app
from conftest import FakeIMAP, make_msg, wait_delete_done, wait_scan_done
from test_folders_panel import _junk, _list, _move, junked  # noqa: F401
from test_purge import _env, _junk_via, _mails

client = TestClient(app)
SRC = Path(__file__).resolve().parent.parent / "frontend" / "src"


def _parse(text: str) -> tuple[str, dict]:
    """What api.ts does with a detail: `code[:key=value,...]`."""
    head, _, rest = text.partition(":")
    params = {}
    for pair in rest.split(",") if rest else []:
        k, _, v = pair.partition("=")
        params[k] = unquote(v)
    return head, params


# ------------------------------------------------------------- convention

def test_a_code_without_params_is_just_the_code():
    assert mailops.coded(mailops.INBOX_MISSING) == "inbox_missing"
    assert mailops.coded(mailops.FOLDER_CHANGED, role="trash") \
        == "folder_changed:role=trash"
    assert mailops.coded(mailops.DELETED_THEN_FAILED, n=3, cause="x") \
        == "deleted_then_failed:n=3,cause=x"


@pytest.mark.parametrize("value", [
    "Posteingang/Rechnungen", "a,b=c:d", "100%", "50 % off, really",
    "Entwürfe", "x" * 300])
def test_param_values_survive_any_character(value):
    text = mailops.coded(mailops.CANNOT_OPEN, folder=value)
    assert text.count(":") == 1 and text.count(",") == 0   # nothing ambiguous
    assert _parse(text) == ("cannot_open", {"folder": value})


def test_a_failure_nests_as_the_cause_of_another():
    inner = mailops.coded(mailops.STRANDED_THEN_FAILED, n=2,
                          cause=mailops.coded(mailops.CANNOT_OPEN,
                                              folder="A,B"))
    outer = mailops.coded(mailops.DELETED_THEN_FAILED, n=5, cause=inner)
    head, params = _parse(outer)
    assert head == "deleted_then_failed" and params["n"] == "5"
    head, params = _parse(params["cause"])
    assert head == "stranded_then_failed" and params["n"] == "2"
    assert _parse(params["cause"]) == ("cannot_open", {"folder": "A,B"})


def test_is_coded_and_error_text():
    assert mailops.is_coded("busy_purge")
    assert mailops.is_coded("folder_changed:role=junk")
    assert not mailops.is_coded("RuntimeError: busy_purge")
    assert not mailops.is_coded("something else: entirely")
    assert mailops.error_text(RuntimeError(mailops.BUSY_PURGE)) == "busy_purge"
    assert mailops.error_text(OSError("boom")) == "OSError: boom"


def _ui_codes() -> dict[str, str]:
    src = (SRC / "api.ts").read_text()
    block = src[src.index("const ERROR_CODES"):]
    block = block[:block.index("};")]
    return dict(re.findall(r'^\s+(\w+): "([\w.]+)",', block, re.M))


def _locale_keys(name: str) -> set[str]:
    return set(re.findall(r'^\s+"([^"]+)":', (SRC / "locales" / name)
                          .read_text(), re.M))


def _backend_codes() -> set[str]:
    """Every code any backend module answers with (HTTP `detail`)."""
    return set(mailops.FOLDER_ERROR_CODES) | aifilter.CODES | {
        v for k, v in vars(knowledgestore).items()
        if k.isupper() and isinstance(v, str) and v.startswith("knowledge_")}


def test_every_code_has_a_translated_text_in_the_ui():
    ui = _ui_codes()
    assert set(mailops.FOLDER_ERROR_CODES) <= set(ui)
    for locale in ("en.ts", "de.ts"):
        keys = _locale_keys(locale)
        assert {k for k in ui.values() if k not in keys} == set(), locale


def test_the_ui_maps_no_code_the_backend_does_not_define():
    """Both directions: a UI entry nothing answers with is dead (a typo or a
    code that was removed), so `ERROR_CODES` equals the union of the codes
    the backend modules define (folder features, pins, knowledge)."""
    assert set(_ui_codes()) == _backend_codes()


def test_every_code_constant_is_registered():
    consts = {v for k, v in vars(mailops).items()
              if k.isupper() and isinstance(v, str)
              and re.fullmatch(r"[a-z]+(_[a-z]+)*", v)}
    assert consts <= mailops.FOLDER_ERROR_CODES


# ----------------------------------------------------- refusals by code

def test_role_listing_without_the_folder(monkeypatch):
    fake = FakeIMAP({"INBOX": [make_msg(1)], "Trash": []})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    r = client.get("/api/folders_panel", params={"role": "junk"})
    assert r.status_code == 409
    assert r.json()["detail"] == "role_missing:role=junk"


def test_not_junk_without_an_inbox(monkeypatch):
    fake = FakeIMAP({"Spam": _junk(), "Trash": []})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    listing = mailops.role_list("junk")
    r = _move("not_junk", [42], listing["uv"])
    assert r.status_code == 409 and r.json()["detail"] == "inbox_missing"


def test_moves_out_of_junk_refuse_by_code(junked):
    listing = _list()
    r = _move("trash", [999], listing["uv"])             # nothing known
    assert r.status_code == 409 and r.json()["detail"] == "no_known_selected"
    r = _move("trash", [42], listing["uv"] + 1)          # an older listing
    assert r.status_code == 409
    assert r.json()["detail"] == "folder_changed:role=junk"
    mailops.STATE["delete"]["status"] = "running"
    r = _move("trash", [42], listing["uv"])
    mailops.STATE["delete"]["status"] = "idle"
    assert r.status_code == 409 and r.json()["detail"] == "busy_action"
    assert len(junked.mailbox["Spam"]) == 3


def test_a_junk_move_into_a_missing_trash_names_the_role(monkeypatch):
    fake = FakeIMAP({"INBOX": [make_msg(1)], "Spam": _junk()})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    listing = mailops.role_list("junk")
    r = _move("trash", [42], listing["uv"])
    assert r.status_code == 409
    assert r.json()["detail"] == "role_missing:role=trash"
    assert len(fake.mailbox["Spam"]) == 3


def test_restore_from_trash_refuses_by_code(bridge):
    bridge.mailbox["Trash"] = [make_msg(30)]
    uv = client.get("/api/trash").json()["uv"]

    def restore(dest):
        return client.post("/api/trash/restore", json={
            "uids": [30], "dest": dest, "uv": uv})
    r = restore("Gone Folder")
    assert r.status_code == 409
    assert r.json()["detail"] == "unknown_target:folder=Gone%20Folder"
    r = restore("Trash")
    assert r.status_code == 409 and r.json()["detail"] == "target_is_trash"
    assert len(bridge.mailbox["Trash"]) == 1


def test_undo_without_an_entry_refuses_by_code(bridge):
    for body in ({"index": -1}, {"index": 4}):
        r = client.post("/api/undo", json=body)
        assert r.status_code == 409
        assert r.json()["detail"] == "nothing_to_undo"


def test_move_of_a_lookalike_without_a_count_refuses_by_code(monkeypatch):
    fake = FakeIMAP({"INBOX": [make_msg(1)], "Trash": [],
                     "Deleted Items": [make_msg(3)]})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    r = client.post("/api/folders/move_contents", json={
        "folder": "Deleted Items", "uv": 0, "max_uid": 3})
    assert r.status_code == 409 and r.json()["detail"] == "count_required"


def test_a_purge_that_stops_after_the_move_names_both_numbers(monkeypatch):
    """Junk goes via Trash: when the delete in Trash fails after the move,
    the mails sit in Trash (stranded) - the code carries that number."""
    fake = _junk_via(monkeypatch, True)
    c = mailops.purge_preview("junk", everything=True)
    orig = fake.uid

    def uid(cmd, *a):
        if cmd == "EXPUNGE":
            return "NO", [b"denied"]
        return orig(cmd, *a)
    fake.uid = uid
    with pytest.raises(mailops.PurgeError) as err:
        mailops.purge_mails("junk", c["uids"], c["uv"], folder=c["folder"],
                            trash_folder=c["trash_folder"])
    assert str(err.value) == mailops.coded(
        mailops.STRANDED_THEN_FAILED, n=3, cause=mailops.CANNOT_EXPUNGE)
    assert (err.value.deleted, err.value.unverified) == (0, 3)


def test_a_purge_that_deleted_some_then_stranded_some_nests_both(monkeypatch):
    monkeypatch.setattr(mailops, "MOVE_CHUNK", 2)
    fake = _env(monkeypatch, junk=_mails(range(1, 6)),
                trash=_mails([2000]), renumber=True, copyuid=True)
    c = mailops.purge_preview("junk", everything=True)
    orig = fake.uid
    expunges = []

    def uid(cmd, *a):
        if cmd == "EXPUNGE":
            expunges.append(1)
            if len(expunges) == 2:
                return "NO", [b"denied"]
        return orig(cmd, *a)
    fake.uid = uid
    with pytest.raises(mailops.PurgeError) as err:
        mailops.purge_mails("junk", c["uids"], c["uv"], folder=c["folder"],
                            trash_folder=c["trash_folder"])
    stranded = mailops.coded(mailops.STRANDED_THEN_FAILED, n=2,
                             cause=mailops.CANNOT_EXPUNGE)
    assert str(err.value) == mailops.coded(
        mailops.DELETED_THEN_FAILED, n=2, cause=stranded)


# ------------------------------------------------------------ undo labels

def test_a_junk_move_records_a_label_the_ui_words_itself(junked):
    listing = _list()
    assert _move("trash", [40, 41], listing["uv"]).status_code == 200
    (entry,) = mailops.STATE["undo"]
    assert entry["label"] == "2 mails from Junk"           # identity + EN
    assert entry["label_key"] == "undo.from_junk"
    assert entry["label_params"] == {"n": 2}


def test_one_mail_is_singular_in_the_english_label(junked):
    listing = _list()
    assert _move("not_junk", [42], listing["uv"]).status_code == 200
    wait_scan_done()
    (entry,) = mailops.STATE["undo"]
    assert entry["label"] == "1 mail from Junk"
    assert entry["label_params"] == {"n": 1}
    assert entry["count"] == 1


def test_an_entry_without_structured_fields_lists_as_before(bridge):
    acc = accountsmod.get()
    with acc.lock:
        acc.undo_log.append({"ts": 5, "label": "news@shop.example",
                             "action": "trash", "count": 2,
                             "items": [("INBOX", "<a@shop.example>")],
                             "in": "Trash"})
        summary = mailops._undo_summaries(acc)
    assert summary == [{"ts": 5, "label": "news@shop.example", "count": 2,
                        "action": "trash"}]


def test_the_restore_notice_carries_the_label_parts(junked):
    listing = _list()
    assert _move("trash", [40, 41], listing["uv"]).status_code == 200
    assert client.post("/api/undo", json={"index": -1}).status_code == 200
    wait_scan_done()
    notice = mailops.STATE["notice"]
    assert notice["key"] in ("restored", "restored_rescan")
    assert notice["params"]["label"] == "2 mails from Junk"
    assert notice["params"]["label_key"] == "undo.from_junk"
    assert notice["params"]["label_n"] == 2


# ------------------------------- the main delete job vs the panel's lists

def test_the_main_delete_job_says_rescan_and_the_panel_says_reload(junked):
    """Same UIDVALIDITY check, two wordings: the cleanup delete works on the
    scan index (only a rescan helps), a role folder's move on its panel
    listing (reload the list)."""
    mailops.run_scan()
    junked.uv["INBOX"] = 5
    mailops.delete_groups("sender", ["news@shop.example"])
    done = wait_delete_done()
    assert done["error"] == "folder_changed_rescan:folder=INBOX"
    assert "rescan" in errortext.describe(done["error"])
    junked.uv["INBOX"] = 1
    listing = _list()
    junked.uv["Spam"] = 9
    r = _move("trash", [42], listing["uv"])
    assert r.status_code == 409
    assert r.json()["detail"] == "folder_changed:folder=Spam"
    assert "reload the list" in errortext.describe(r.json()["detail"])


# ------------------------------------------------- the audit entry's error

def test_a_failed_role_move_audits_its_error_as_a_code(junked, monkeypatch):
    listing = _list()
    junked.uv["Spam"] = 9                    # the move itself refuses
    assert _move("trash", [42], listing["uv"]).status_code == 409
    junked.uv["Spam"] = 1

    def boom(*a, **k):
        raise RuntimeError(mailops.CANNOT_MOVE)
    monkeypatch.setattr(mailops, "_uid_move", boom)
    r = _move("trash", [42], listing["uv"])
    assert r.status_code == 409 and r.json()["detail"] == "cannot_move"
    errors = [e["error"] for e in auditlog.load("default", 0, 50)["entries"]
              if e["outcome"] == "error"]
    # a code, never "RuntimeError: ..." (which the tooltip cannot word)
    assert sorted(errors) == ["cannot_move", "folder_changed:folder=Spam"]
    assert errortext.describe("cannot_move") == "The server refused the move."


def test_a_non_coded_failure_keeps_its_type_in_the_audit_error():
    assert mailops.error_text(OSError("boom")) == "OSError: boom"


# ----------------------------------------------- the audit CSV export text

def test_the_csv_export_words_coded_errors_in_english(bridge):
    auditlog.record("empty_trash", count=2, outcome="partial",
                    error="deleted_then_failed:n=2,cause=cannot_expunge")
    auditlog.record("purge", outcome="error", error="folder_changed:role=junk")
    auditlog.record("trash", outcome="error",
                    error="RuntimeError: some older plain text")
    body = client.get("/api/audit/export").text
    assert "The server did not remove the marked mails. (2 mails were " \
        "permanently deleted before the failure)" in body
    assert "The “Junk” folder changed on the server" in body
    assert "RuntimeError: some older plain text" in body
    assert "deleted_then_failed" not in body and "folder_changed" not in body


# ----------------------------------------- backend English == the locale

def _en_text(key: str) -> str | None:
    src = (SRC / "locales" / "en.ts").read_text()
    m = re.search(r'^  "%s":\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+),'
                  % re.escape(key), src, re.M)
    if not m:
        return None
    text = "".join(re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(1)))
    return re.sub(r"\\u([0-9a-f]{4})", lambda x: chr(int(x.group(1), 16)),
                  text)


def test_the_backends_english_equals_the_english_locale():
    ui = _ui_codes()
    new = {c for c in ui if ui[c].startswith("ferr.")}
    assert set(errortext.TEXT) == new
    for code in new:
        text = errortext.TEXT[code]
        many, one = text if isinstance(text, tuple) else (text, None)
        assert many == _en_text(ui[code]), code
        assert one == _en_text(ui[code] + "_one"), code


def test_every_new_code_has_an_english_text():
    ours = set(mailops.FOLDER_ERROR_CODES) - {
        mailops.NO_MESSAGE_ID, mailops.PINNED_MAILS, mailops.PROTECTED_MAILS,
        mailops.ALL_PINNED, mailops.ROLE_NOT_CANDIDATE, mailops.ROLE_AMBIGUOUS,
        mailops.NOT_LOOKALIKE, mailops.MOVE_UNSAFE}
    assert set(errortext.TEXT) == ours


def test_describe_words_params_plurals_and_causes():
    d = errortext.describe
    assert d("busy_purge") == errortext.TEXT["busy_purge"]
    assert d("role_missing:role=archive") == \
        "No “Archive” folder found on the server."
    assert d("role_missing:role=trash") == \
        "No “Trash” folder found on the server."
    assert d("role_missing:role=junk") == \
        "No “Junk” folder found on the server."
    assert d("unknown_target:folder=Projekte%2C%20neu") == \
        "The target folder “Projekte, neu” does not exist."
    inner = mailops.coded(mailops.STRANDED_THEN_FAILED, n=1,
                          cause=mailops.CANNOT_EXPUNGE)
    assert d(mailops.coded(mailops.DELETED_THEN_FAILED, n=3, cause=inner)) == (
        "The server did not remove the marked mails. (1 mail was moved to "
        "Trash and not deleted) (3 mails were permanently deleted before "
        "the failure)")
    assert d("rule_purge_filter:names=tag%3A%2C%20ai%3A").endswith(
        "Trash rules: tag:, ai:")


@pytest.mark.parametrize("raw", [
    "", "a_future_code", "a_future_code:n=2", "RuntimeError: x",
    "cannot_open:folder", "cannot_open:=x", "cannot_open:folder=%E0%A4%A",
    "cannot_open:a=1,,b=2"])
def test_describe_returns_anything_else_as_it_is(raw):
    assert errortext.describe(raw) == raw
