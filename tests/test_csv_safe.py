"""CSV injection: every exported string cell that a spreadsheet would run as
a formula (leading = + - @ TAB CR) gets a leading apostrophe; numbers, dates,
empty cells and ordinary text are written exactly as before."""

import csv
import io

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import auditlog
from backend import csvsafe
from backend import errortext
from backend import mailops
from backend.main import app

client = TestClient(app)

TRIGGERS = ["=", "+", "-", "@", "\t", "\r"]


def parse(text):
    return list(csv.reader(io.StringIO(text, newline="")))


# ------------------------------------------------------------------ helper

@pytest.mark.parametrize("lead", TRIGGERS)
def test_cell_neutralises_each_trigger(lead):
    assert csvsafe.cell(lead + "HYPERLINK(1)") == "'" + lead + "HYPERLINK(1)"
    assert csvsafe.cell(lead) == "'" + lead


@pytest.mark.parametrize("value", [
    "plain text", "a=b", "x+y", "2026-10-21", "2026-10-21T08:00:00Z",
    "0", "'=already quoted", "'", "", " =leading space", "line\n=second"])
def test_cell_leaves_other_strings_alone(value):
    assert csvsafe.cell(value) == value


@pytest.mark.parametrize("value", [0, 7, -5, -1.5, 3.25, True, None])
def test_cell_leaves_numbers_and_empty_alone(value):
    assert csvsafe.cell(value) is value


def test_row_applies_to_every_cell():
    assert csvsafe.row(["=a", 1, -2, "ok", "@b", ""]) == \
        ["'=a", 1, -2, "ok", "'@b", ""]


# ------------------------------------------------- audit log export (API)

def audit_rows():
    body = client.get("/api/audit/export").text
    return parse(body)[1:]


@pytest.mark.parametrize("lead", TRIGGERS)
def test_audit_export_neutralises_every_string_column(bridge, lead):
    auditlog.record(lead + "act", actor=lead + "who", account="default",
                    label=lead + "label", outcome=lead + "out",
                    error=lead + "err")
    (row,) = audit_rows()
    # ts, account, actor, action, count, bytes, label, outcome, error
    assert row[2:4] == ["'" + lead + "who", "'" + lead + "act"]
    assert row[6:] == ["'" + lead + "label", "'" + lead + "out",
                       "'" + lead + "err"]


def test_audit_export_formula_label_is_text(bridge):
    auditlog.record("trash", count=2, size=1500, account="default",
                    label='=HYPERLINK("https://evil.example","x")')
    (row,) = audit_rows()
    assert row[6] == '\'=HYPERLINK("https://evil.example","x")'


def test_audit_export_normal_data_is_byte_identical(bridge):
    auditlog.record("trash", count=3, size=2048, account="default",
                    label="noreply@dhl.example", error="a, \"quoted\" error")
    auditlog.record("purge", count=0, size=0, account="default",
                    label="'=quoted", outcome="error", error="")
    lines = client.get("/api/audit/export").text.splitlines()
    assert lines[0] == "ts,account,actor,action,count,bytes,label,outcome,error"
    rows = parse(client.get("/api/audit/export").text)[1:]
    newest, older = rows
    assert newest[3:9] == ["purge", "0", "0", "'=quoted", "error", ""]
    assert older[3:] == ["trash", "3", "2048", "noreply@dhl.example", "ok",
                         'a, "quoted" error']
    assert older[0].isdigit()            # the timestamp stays a bare number


def test_audit_export_numbers_are_not_prefixed(bridge):
    auditlog.record("trash", count=-4, size=-1, account="default")
    (row,) = audit_rows()
    assert row[4:6] == ["-4", "-1"]


def test_audit_export_decodes_a_coded_error_then_neutralises_it(bridge,
                                                                monkeypatch):
    # A coded error is worded first; a decoded text that starts with a
    # trigger (here via a folder name filling the leading placeholder) is
    # then neutralised like any other cell.
    monkeypatch.setitem(errortext.TEXT, "cannot_open",
                        "{folder} cannot be opened")
    auditlog.record("purge", outcome="error", account="default",
                    error=mailops.coded("cannot_open", folder="=SUM(1)"))
    auditlog.record("purge", outcome="error", account="default",
                    error=mailops.coded("cannot_open", folder="Spam"))
    newest, older = audit_rows()
    assert newest[8] == "Spam cannot be opened"
    assert older[8] == "'=SUM(1) cannot be opened"


def test_audit_export_coded_error_leaves_plain_text_decoding_alone(bridge):
    auditlog.record("purge", outcome="error", account="default",
                    error="folder_changed:role=junk")
    (row,) = audit_rows()
    assert row[8] == errortext.describe("folder_changed:role=junk")
    assert not row[8].startswith("'")


# ------------------------------------------------- group export (/api/export)

def scanned_record():
    mailops.run_scan()
    return accountsmod.get().state["groups"]["sender"]["noreply@dhl.example"]


def export_rows(**params):
    params.setdefault("grouping", "sender")
    return parse(client.get("/api/export", params=params).text)


@pytest.mark.parametrize("lead", TRIGGERS)
def test_group_export_neutralises_every_string_column(bridge, lead):
    rec = scanned_record()
    rec["label"] = lead + "label"
    rec["tags"] = [lead + "tag"]
    rec["ai"] = {"verdict": lead + "verdict", "reason": lead + "reason"}
    rows = export_rows(keys=["noreply@dhl.example"])
    assert rows[0][:2] == ["key", "label"]
    (row,) = rows[1:]
    assert row[1] == "'" + lead + "label"
    assert row[7:] == ["'" + lead + "tag", "'" + lead + "verdict",
                       "'" + lead + "reason"]


def test_group_export_key_is_neutralised(bridge):
    rec = scanned_record()
    groups = accountsmod.get().state["groups"]["sender"]
    rec["key"] = "=cmd|' /C calc'!A0"
    groups["=cmd|' /C calc'!A0"] = groups.pop("noreply@dhl.example")
    (row,) = export_rows(keys=["=cmd|' /C calc'!A0"])[1:]
    assert row[0] == "'=cmd|' /C calc'!A0"


def test_group_export_normal_data_is_unchanged(bridge):
    rec = scanned_record()
    rec["ai"] = {"verdict": "keep", "reason": "it's fine, really"}
    (row,) = export_rows(keys=["noreply@dhl.example"])[1:]
    assert row[0] == "noreply@dhl.example"
    assert row[2:4] == [str(rec["count"]), str(rec["size"])]
    assert row[5] == rec["first"] and row[5][:4].isdigit()
    assert row[6] == rec["last"]
    assert row[8:] == ["keep", "it's fine, really"]


def test_group_export_negative_numbers_stay_numbers(bridge):
    rec = scanned_record()
    rec["size"] = -12
    (row,) = export_rows(keys=["noreply@dhl.example"])[1:]
    assert row[3] == "-12"


def test_group_export_without_ai_and_quote_led_label_unchanged(bridge):
    rec = scanned_record()
    rec["label"] = "'=already text"
    rec["ai"] = None
    (row,) = export_rows(keys=["noreply@dhl.example"])[1:]
    assert row[1] == "'=already text" and row[8:] == ["", ""]
