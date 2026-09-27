"""Pure-function unit tests (no IMAP, no network)."""

from backend import config as cfgmod
from backend import mailops
from backend.unsub import parse_unsub


def test_categorize():
    assert "shipping" in mailops.categorize("noreply@dhl.example DHL Paket")
    assert "finance" in mailops.categorize("service@paypal.example invoice")
    assert "automated" in mailops.categorize("x", localpart="no-reply")
    assert "newsletter" in mailops.categorize("x", bulk=True)
    assert mailops.categorize("alice@friends.example hi there") == []


def test_norm_subject():
    n = mailops.norm_subject
    assert n("Re: Re: Order 123 shipped") == n("AW: Order 999 shipped")
    assert n("FWD:  Hello   World") == "hello world"
    assert n("") == "(no subject)"
    assert len(n("x" * 500)) <= 120


def test_decode_mutf7():
    assert mailops.decode_mutf7("Sp&AOQ-ter pr&APw-fen") == "Später prüfen"
    assert mailops.decode_mutf7("Plain") == "Plain"
    assert mailops.decode_mutf7("A &- B") == "A & B"


def test_excluded_rules():
    rules = ["Trash", "Labels/*"]
    assert mailops.excluded("trash", rules)
    assert mailops.excluded("Labels/Foo", rules)
    assert not mailops.excluded("INBOX", rules)
    assert not mailops.excluded("Trashy", rules)


def test_quote_folder():
    assert mailops.quote_folder('a"b\\c') == '"a\\"b\\\\c"'


def test_parse_unsub():
    p = parse_unsub("<mailto:u@x.example>, <https://x.example/u>", True)
    assert p["mailto"] == "mailto:u@x.example"
    assert p["http"] == "https://x.example/u"
    assert p["one_click"]
    assert parse_unsub("<https://only.example/u>", False)["mailto"] is None
    assert parse_unsub("", False) == {"mailto": None, "http": None,
                                      "one_click": False}


def test_effective_prices():
    assert cfgmod.effective_prices({"model": "claude-sonnet-5"}) == (2.0, 10.0)
    assert cfgmod.effective_prices({"model": "claude-haiku-4-5"}) == (1.0, 5.0)
    # explicit override wins
    assert cfgmod.effective_prices(
        {"model": "claude-sonnet-5", "price_in": 1.5, "price_out": 7}
    ) == (1.5, 7)
    # unknown model, no override -> zeros
    assert cfgmod.effective_prices({"model": "mystery"}) == (0, 0)


def test_record_usage_accumulates():
    ai = {"model": "claude-sonnet-5"}
    r1 = cfgmod.record_usage(ai, 1_000_000, 100_000)
    assert abs(r1["cost"] - 3.0) < 1e-9          # 1M*2 + 0.1M*10
    r2 = cfgmod.record_usage(ai, 500_000, 0)
    assert abs(r2["total"]["cost"] - 4.0) < 1e-9
    assert r2["total"]["runs"] == 2
    cfgmod.reset_stats()
    assert cfgmod.load_stats()["runs"] == 0


def test_config_masking_and_profiles():
    cfgmod.update_config({"imap": {"user": "a@b.c", "password": "secret"},
                          "ai": {"api_key": "sk-xyz"}})
    masked = cfgmod.masked_config(cfgmod.load_config())
    assert masked["imap"]["password"] == ""
    assert masked["imap"]["password_set"] is True
    assert masked["ai"]["api_key"] == ""
    assert masked["ai"]["api_key_set"] is True

    cfgmod.update_config({"save_profile_as": "work"})
    cfg = cfgmod.load_config()
    assert cfg["active_profile"] == "work"
    assert cfg["imap"]["user"] == ""            # fresh account
    assert cfg["profiles"]["default"]["user"] == "a@b.c"

    cfgmod.update_config({"switch_profile": "default"})
    cfg = cfgmod.load_config()
    assert cfg["active_profile"] == "default"
    assert cfg["imap"]["user"] == "a@b.c"
    assert cfg["imap"]["password"] == "secret"


def test_config_bad_port_ignored():
    before = cfgmod.load_config()["imap"]["port"]
    cfgmod.update_config({"imap": {"port": "abc"}})
    assert cfgmod.load_config()["imap"]["port"] == before
