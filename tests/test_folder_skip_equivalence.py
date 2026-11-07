"""The setup wizard's folder step is optional: skipping it (nothing saved, the
backend's DEFAULT_EXCLUDED stays) must scan exactly the folders that accepting
the listed defaults (wildcards + every listed excluded folder, saved as the
old folders step did) scans - on several mailbox layouts, and still after
folders were added later. All data is invented (.example)."""
import pytest
from fastapi.testclient import TestClient
from backend import accounts, mailops
from backend.main import app
from conftest import FakeIMAP, make_msg

client = TestClient(app)

def _box(names):
    return {f: [make_msg(1, frm=f"s{n}@shop{n}.example")]
            for n, f in enumerate(names)}

SCEN = {
  "proton": (["INBOX", "Archive", "Trash", "Spam", "Sent", "Drafts",
              "All Mail", "Starred", "Labels", "Labels/work", "Folders",
              "Folders/bills"], {}, False),
  "flags_odd_names": (["INBOX", "Deleted Items", "Junk E-mail",
                       "Sent Items", "Entwuerfe", "Projects", "Archive",
                       "Deleted Messages"],
                      {"Deleted Items": "\\Trash", "Junk E-mail": "\\Junk",
                       "Sent Items": "\\Sent", "Entwuerfe": "\\Drafts",
                       "Archive": "\\Archive"}, False),
  "gmail": (["INBOX", "[Gmail]/All Mail", "[Gmail]/Trash", "[Gmail]/Spam",
             "[Gmail]/Sent Mail", "[Gmail]/Drafts", "[Gmail]/Starred",
             "[Gmail]/Important", "Receipts"],
            {"[Gmail]/All Mail": "\\All", "[Gmail]/Trash": "\\Trash",
             "[Gmail]/Spam": "\\Junk", "[Gmail]/Sent Mail": "\\Sent",
             "[Gmail]/Drafts": "\\Drafts", "[Gmail]/Starred": "\\Flagged",
             "[Gmail]/Important": "\\Important"}, True),
  "noflags_lowercase": (["INBOX", "junk", "trash", "sent", "drafts",
                         "spam", "Newsletters", "Bin"], {}, False),
}
LATER = ["Later stuff", "Labels/newlabel", "Spam", "Trash", "Drafts",
         "Sent", "Junk", "Deleted Messages", "INBOX/sub"]

def scan(fake):
    mailops.run_scan()
    return set(accounts.get().state["folders"])

def _accept_rules(listed):
    # what the old folders step saved on "Next" with nothing changed
    return listed["wildcards"] + [f["raw"] for f in listed["folders"]
                                  if f["excluded"]]


@pytest.mark.parametrize("name", list(SCEN))
def test_skip_equals_accept(monkeypatch, name):
    names, flags, gm = SCEN[name]
    fake = FakeIMAP(_box(names), flags=flags, gmail=gm)
    monkeypatch.setattr(mailops, "connect", lambda cfg, n=None: fake)
    listed = client.get("/api/folders").json()
    preticked = {f["name"] for f in listed["folders"] if not f["excluded"]}
    saved = client.get("/api/config").json()["accounts"]
    default_rules = list(next(iter(saved.values()))["excluded_folders"])

    skip = scan(fake)                       # nothing saved: the defaults
    r = client.post("/api/config",
                    json={"excluded_folders": _accept_rules(listed)})
    assert r.status_code == 200, r.text
    accept = scan(fake)
    assert skip == accept == preticked

    # folders that appear after setup: the skip path keeps the defaults, the
    # accept path keeps the explicit list it saved - both scan the same set
    later = names + [f for f in LATER if f not in names]
    fake2 = FakeIMAP(_box(later), flags=flags, gmail=gm)
    monkeypatch.setattr(mailops, "connect", lambda cfg, n=None: fake2)
    accept_later = scan(fake2)
    client.post("/api/config", json={"excluded_folders": default_rules})
    skip_later = scan(fake2)
    assert skip_later == accept_later, (sorted(skip_later - accept_later),
                                        sorted(accept_later - skip_later))
