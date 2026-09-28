"""Property-based fuzzing of every parser that sees UNTRUSTED input
(mail headers, IMAP responses, user filter queries). The property is
always the same: any input yields the right TYPE and never an exception -
one hostile mail must never take down a scan (the raw-8-bit-header crash
taught us that the hard way)."""

import email as email_mod

from hypothesis import given, settings
from hypothesis import strategies as st

from backend import auth as authmod
from backend import config as cfgmod
from backend import mailops, unsub
from backend import rules as rulesmod

anything_texty = st.one_of(
    st.none(), st.text(), st.binary().map(lambda b: b.decode("latin-1")))


@given(anything_texty)
def test_decode_mime_total(raw):
    assert isinstance(mailops.decode_mime(raw), str)


@given(st.binary(max_size=300))
def test_decode_mime_on_raw_header_objects(blob):
    msg = email_mod.message_from_bytes(b"Subject: " + blob + b"\r\n\r\n")
    assert isinstance(mailops.decode_mime(msg.get("Subject", "")), str)


@given(st.text(max_size=200))
def test_decode_mutf7_total(name):
    assert isinstance(mailops.decode_mutf7(name), str)


@given(st.binary(max_size=400))
@settings(max_examples=200)
def test_bodystructure_parser_total(blob):
    parsed = mailops._bs_parse(mailops._bs_tokenize(blob))
    out: list = []
    if parsed:
        mailops._bs_attachments(parsed[0], out)
    assert isinstance(out, list)


@given(st.text(max_size=300), st.booleans())
def test_parse_unsub_total(header, one_click):
    parts = unsub.parse_unsub(header, one_click)
    assert set(parts) == {"mailto", "http", "one_click"}


@given(st.text(max_size=200))
def test_norm_subject_total(subject):
    out = mailops.norm_subject(subject)
    assert isinstance(out, str) and 0 < len(out) <= 120


@given(st.text(max_size=200))
def test_filter_dsl_total(query):
    f = rulesmod.parse_filter(query)
    group = {"key": "a@b.c", "label": "A", "sub": "", "tags": ["newsletter"],
             "count": 3, "unread": 1, "size": 100, "last": "2026-01-01",
             "ai": None, "unsub": False, "protected": False,
             "replied": False, "att_size": 0}
    assert isinstance(rulesmod.match_group(group, f), bool)


@given(st.lists(st.one_of(st.none(), st.text(max_size=50), st.integers()),
                max_size=20))
def test_normalize_protected_total(entries):
    out = cfgmod.normalize_protected(entries)
    assert all(isinstance(e, str) and "@" in e for e in out)


@given(st.text(max_size=200))
def test_session_and_state_verification_total(token):
    assert authmod.verify_session(token) in (None,) \
        or isinstance(authmod.verify_session(token), str)
    assert isinstance(authmod.verify_state(token), bool)


@given(st.text(max_size=100), st.text(max_size=100))
def test_verify_password_total(password, stored):
    assert isinstance(authmod.verify_password(password, stored), bool)
