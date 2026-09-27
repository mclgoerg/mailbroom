"""User-editable category rules."""

from fastapi.testclient import TestClient

from backend import config as cfgmod
from backend import mailops
from backend.main import app

client = TestClient(app)


def test_effective_categories_merge():
    default = dict(mailops.CATEGORY_RULES)
    eff = dict(mailops.effective_categories(None))
    assert eff == default

    eff = dict(mailops.effective_categories({
        "shipping": ["mycarrier"],          # replace built-in keywords
        "finance": [],                      # disable a built-in
        "insurance": ["allianz", "huk"],    # brand-new category
    }))
    assert eff["shipping"] == ["mycarrier"]
    assert "finance" not in eff
    assert eff["insurance"] == ["allianz", "huk"]
    assert eff["social"] == default["social"]      # untouched


def test_custom_categories_apply_on_scan(bridge):
    cfgmod.update_config({"categories": {
        "shipping": ["nothing-matches-this"],
        "friends": ["Friends.example"],            # normalized to lowercase
    }})
    mailops.run_scan()
    senders = mailops.STATE["groups"]["sender"]
    assert "shipping" not in senders["noreply@dhl.example"]["tags"]
    assert "friends" in senders["alice@friends.example"]["tags"]


def test_categories_config_roundtrip():
    cfg = client.post("/api/config", json={
        "categories": {" Insurance ": ["Allianz", " ", "HUK"],
                       "bad": "not-a-list", "": ["x"]}}).json()
    assert cfg["categories"] == {"insurance": ["allianz", "huk"]}
