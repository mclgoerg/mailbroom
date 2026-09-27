"""Attachment explorer: BODYSTRUCTURE parsing, analysis job, att: filter."""

from fastapi.testclient import TestClient

from backend import mailops
from backend import rules as rulesmod
from backend.main import app

from conftest import wait_delete_done

client = TestClient(app)


def _wait_atts(timeout=5.0):
    import time
    end = time.time() + timeout
    while time.time() < end:
        with mailops.STATE_LOCK:
            if mailops.STATE["atts"]["status"] != "running":
                return mailops.STATE["atts"]
        time.sleep(0.02)
    raise TimeoutError("attachment analysis did not finish")


# ------------------------------------------------------------------- parser

def test_bodystructure_parser_variants():
    def atts(bs: bytes):
        out: list = []
        parsed = mailops._bs_parse(mailops._bs_tokenize(bs))
        mailops._bs_attachments(parsed[0], out)
        return out

    # plain text mail: no attachments
    assert atts(b'(("text" "plain" ("charset" "utf-8") NIL NIL "7bit" '
                b'100 5))') == []

    # disposition attachment wins, filename from disposition params
    got = atts(b'((("text" "plain" NIL NIL NIL "7bit" 10 1)'
               b'("application" "pdf" ("name" "x.pdf") NIL NIL "base64" '
               b'5000 NIL ("attachment" ("filename" "Rechnung 2026.pdf")) '
               b'NIL) "mixed" NIL NIL NIL))')
    assert got == [{"name": "Rechnung 2026.pdf", "size": 5000}]

    # named non-text part counts even without a disposition
    got = atts(b'((("text" "html" NIL NIL NIL "7bit" 10 1)'
               b'("image" "png" ("name" "chart.png") NIL NIL "base64" '
               b'2222) "related" NIL NIL NIL))')
    assert got == [{"name": "chart.png", "size": 2222}]

    # inline images without filename are NOT counted
    assert atts(b'((("text" "html" NIL NIL NIL "7bit" 10 1)'
                b'("image" "gif" NIL NIL NIL "base64" 99 NIL '
                b'("inline" NIL) NIL) "related" NIL NIL NIL))') == []

    # escaped quotes inside quoted strings survive tokenizing
    got = atts(b'(("application" "zip" ("name" "a \\"b\\".zip") NIL NIL '
               b'"base64" 7 NIL ("attachment" NIL) NIL))')
    assert got[0]["name"] == 'a "b".zip' and got[0]["size"] == 7


# ------------------------------------------------------------------ end2end

def test_analysis_annotates_index_and_groups(bridge):
    mailops.run_scan()
    assert client.post("/api/attachments", json={}).json() == {"ok": True}
    st = _wait_atts()
    assert st["status"] == "done", st["error"]
    assert st["mails"] == 1 and st["size"] == 28000

    lst = client.get("/api/attachments").json()
    assert len(lst) == 1
    assert lst[0]["addr"] == "news@shop.example"
    assert lst[0]["att_size"] == 28000
    assert [a["name"] for a in lst[0]["atts"]] == ["catalog.pdf", "promo.jpg"]

    pub = mailops.public_state()["groups"]["sender"]
    assert pub["news@shop.example"]["att_size"] == 28000
    assert pub["noreply@dhl.example"]["att_size"] == 0

    # att: filter works on groups (frontend parity in lib.test.ts)
    f = rulesmod.parse_filter("att:>10k")
    assert f["att_min"] == 10240
    assert rulesmod.match_group(pub["news@shop.example"], f)
    assert not rulesmod.match_group(pub["noreply@dhl.example"], f)
    assert rulesmod.parse_filter("att:>1m")["att_min"] == 1048576
    assert rulesmod.parse_filter("att:5")["att_min"] == 5

    # deleting the mail shrinks the group aggregate
    mailops.delete_messages([["INBOX", 4]])
    wait_delete_done()
    pub = mailops.public_state()["groups"]["sender"]
    assert "news@shop.example" not in pub          # only mail of the group


def test_analysis_requires_scan():
    assert client.post("/api/attachments", json={}).status_code == 409
