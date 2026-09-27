"""Config export/import: no secrets out, no secrets in, state merged."""

from fastapi.testclient import TestClient

from backend import config as cfgmod
from backend import mailops
from backend import rules as rulesmod
from backend import verdictstore
from backend.main import app

client = TestClient(app)


def test_export_has_state_but_no_secrets():
    cfgmod.update_config({
        "imap": {"user": "me@pm.example", "password": "s3cret-pass"},
        "ai": {"api_key": "sk-secret-key"},
        "protected": ["boss@work.example"],
        "categories": {"insurance": ["allianz"]}})
    rulesmod.create_rule({"name": "r1", "query": "tag:shipping"})
    verdictstore.save("sender", {"a@b.c": {"verdict": "keep", "reason": "x"}})
    verdictstore.save_mails({"<m1@x>": "delete_safe"})
    mailops.REPLIED_TO.add("friend@x.example")
    mailops.save_replied()

    r = client.get("/api/export_config")
    assert "attachment" in r.headers["content-disposition"]
    text = r.text
    assert "s3cret-pass" not in text and "sk-secret-key" not in text
    data = r.json()
    acct = data["config"]["accounts"]["default"]
    assert acct["user"] == "me@pm.example"
    assert "password" not in acct
    assert "api_key" not in data["config"]["ai"]
    assert data["config"]["protected"] == ["boss@work.example"]
    assert data["rules"][0]["name"] == "r1"
    assert data["rules"][0]["account"] == "default"
    verd = data["verdicts"]["accounts"]["default"]
    assert verd["sender"]["a@b.c"]["verdict"] == "keep"
    assert data["replied"] == {"default": ["friend@x.example"]}


def test_import_applies_and_stays_safe():
    cfgmod.update_config({"imap": {"password": "keep-me"},
                          "ai": {"api_key": "keep-key"}})
    # a pre-existing rule that the import replaces
    old = rulesmod.create_rule({"name": "old", "query": "x"})

    body = {
        "version": 2,
        "config": {
            "accounts": {"default": {"user": "new@pm.example",
                                     "password": "evil-overwrite"}},
            "ai": {"model": "claude-haiku-4-5", "api_key": "evil-key"},
            "protected": ["@bank.example"],
            "categories": {"pets": ["dog"]},
        },
        "rules": [{"name": "imported", "query": "tag:shipping",
                   "mode": "execute", "report_runs": 99}],
        "verdicts": {"accounts": {"default": {"sender": {
                         "x@y.z": {"verdict": "review", "reason": ""}}}},
                     "_mails": {"<a@b>": "keep", "<c@d>": "bogus"}},
        "replied": {"default": ["pal@x.example", "not-an-addr"]},
    }
    r = client.post("/api/import_config", json=body)
    assert r.json()["ok"] and r.json()["rules"] == 1

    cfg = cfgmod.load_config()
    im = cfg["accounts"]["default"]
    assert im["user"] == "new@pm.example"
    assert im["password"] == "keep-me"                 # secret untouched
    assert cfg["ai"]["api_key"] == "keep-key"
    assert cfg["ai"]["model"] == "claude-haiku-4-5"
    assert cfg["protected"] == ["@bank.example"]

    rules = rulesmod.load_rules()
    assert [rl["name"] for rl in rules] == ["imported"]
    assert rules[0]["mode"] == "report"                # forced back
    assert rules[0]["report_runs"] == 0
    assert not any(rl["id"] == old["id"] for rl in rules)

    imported = verdictstore.load_account()
    assert imported["sender"]["x@y.z"]["verdict"] == "review"
    assert verdictstore.load_mails() == {"<a@b>": "keep"}
    assert "pal@x.example" in mailops.load_replied()
    assert "not-an-addr" not in mailops.load_replied()


def test_test_connection(bridge):
    # no password configured -> 400
    r = TestClient(app).post("/api/test_connection", json={})
    assert r.status_code == 400

    cfgmod.update_config({"imap": {"password": "bridge-pass"}})
    r = client.post("/api/test_connection", json={})
    assert r.json()["ok"] and r.json()["folders"] >= 4


def test_test_connection_failure(monkeypatch):
    cfgmod.update_config({"imap": {"password": "bridge-pass"}})

    def boom(cfg):
        raise ConnectionRefusedError("nobody home")
    monkeypatch.setattr(mailops, "connect", boom)
    r = client.post("/api/test_connection", json={})
    assert r.status_code == 502 and "nobody home" in r.json()["detail"]
