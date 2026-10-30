"""Your year in mail: a story-style summary of one calendar year.

Pure aggregation over the scanned index (`compute`) plus the cleanup
tallies of `stats.py` and the audit log; `build` gathers those for one
account. Strictly per account, read-only, and metadata only: sender
labels / addresses, counts and sizes - never a subject or a body.

Based on the mail that is in the mailbox NOW: mail that was deleted since
is not counted as received (the UI says so).

Time zones: the browser sends its offset as minutes EAST of UTC; the year,
month, weekday and hour of every mail are taken in that offset (a single
fixed offset - good enough for a story card, DST shifts are ignored).
"""

from __future__ import annotations

import time
from collections import Counter

from . import accounts
from . import auditlog
from . import rules as rulesmod
from . import stats as statsmod

GHOST_MIN_MAILS = 10          # a ghost sender mailed at least this often...
TOP_SENDERS = 5               # ...the story shows the top five senders...
TOP_GHOSTS = 3                # ...and the top three ghosts


def _local(ts: int, tz: int):
    return time.gmtime(ts + tz * 60)


def _top(counter: Counter, n: int) -> list:
    """Highest count first; ties broken by key so the order is stable."""
    return sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:n]


def compute(mails: list[dict], year: int | None, tz: int, now: int,
            actions: dict, audit: list[dict], rule_names: dict) -> dict:
    """The wrapped payload for `year` (default: the newest year with mail,
    else the current one). `actions` is stats.load()["actions"], `audit`
    the account's audit entries, `rule_names` {rule id: name}."""
    first_seen: dict[str, int] = {}
    present: set[int] = set()
    for m in mails:
        if not m["ts"]:
            continue
        a = m["addr"]
        if a not in first_seen or m["ts"] < first_seen[a]:
            first_seen[a] = m["ts"]
        present.add(_local(m["ts"], tz).tm_year)
    current = _local(now, tz).tm_year
    if year is None:
        year = max(present, default=current)

    mine = [m for m in mails
            if m["ts"] and _local(m["ts"], tz).tm_year == year]
    per_sender: dict[str, list[dict]] = {}
    months: Counter = Counter()
    weekdays: Counter = Counter()
    hours: Counter = Counter()
    read = size = 0
    for m in mine:
        lt = _local(m["ts"], tz)
        per_sender.setdefault(m["addr"], []).append(m)
        months[lt.tm_mon] += 1
        weekdays[lt.tm_wday] += 1
        hours[lt.tm_hour] += 1
        read += 1 if m["seen"] else 0
        size += m["size"]

    def label(addr: str) -> str:
        names = Counter(m["name"] for m in per_sender[addr] if m["name"])
        return _top(names, 1)[0][0] if names else addr

    def sender_row(addr: str) -> dict:
        ms = per_sender[addr]
        return {"label": label(addr), "addr": addr, "mails": len(ms),
                "bytes": sum(m["size"] for m in ms)}

    ghosts = [a for a, ms in per_sender.items()
              if len(ms) >= GHOST_MIN_MAILS and not any(m["seen"] for m in ms)]
    ghost_counts = Counter({a: len(per_sender[a]) for a in ghosts})

    def peak(counter: Counter):
        if not counter:
            return None
        key, n = _top(counter, 1)[0]
        return key, n

    out: dict = {
        "year": year, "partial": year == current,
        "note": "Based on the mail in your mailbox now; mail deleted since "
                "is not counted as received.",
        "years": sorted(present | {year}),
        "received": {
            "mails": len(mine), "bytes": size,
            "senders": len(per_sender), "read": read,
            "new_senders": sum(
                1 for a in per_sender
                if _local(first_seen[a], tz).tm_year == year),
        },
        "top_senders": [sender_row(a) for a, _ in _top(
            Counter({a: len(ms) for a, ms in per_sender.items()}),
            TOP_SENDERS)],
        "loudest_month": None, "busiest_weekday": None,
        "busiest_hour": None, "biggest": None,
        "ghosts": {"count": len(ghosts),
                   "top": [sender_row(a)
                           for a, _ in _top(ghost_counts, TOP_GHOSTS)]},
    }
    if mine:
        mo, n = peak(months)
        out["loudest_month"] = {"month": mo, "mails": n}
        wd, n = peak(weekdays)
        out["busiest_weekday"] = {"weekday": wd, "mails": n}
        hr, n = peak(hours)
        out["busiest_hour"] = {"hour": hr, "mails": n}
        big = max(mine, key=lambda m: (m["size"], m["addr"]))
        out["biggest"] = {"label": label(big["addr"]), "addr": big["addr"],
                          "bytes": big["size"]}

    # cleanup: stats tallies are keyed by server-local "YYYY-MM"
    tally = Counter()
    for month, t in actions.items():
        if month[:4] == str(year):
            for k in ("trash", "archive", "purge", "purged_bytes"):
                tally[k] += t.get(k, 0)
    unsubs = rule_runs = 0
    by_rule: Counter = Counter()
    for e in audit:
        if _local(e["ts"], tz).tm_year != year:
            continue
        if e["action"] == "unsubscribe" and e["outcome"] == "done":
            unsubs += 1
        elif e["action"] == "rule_execute" and e["outcome"] == "ok" \
                and e["count"] > 0:
            rule_runs += 1
            by_rule[e["actor"].removeprefix("rule:")] += e["count"]
    top_rule = None
    if by_rule:
        rid, n = _top(by_rule, 1)[0]
        name = rule_names.get(rid)
        top_rule = {"name": name or "", "deleted": name is None, "mails": n}
    out["cleanup"] = {
        "trashed": tally["trash"], "archived": tally["archive"],
        "purged": tally["purge"], "freed_bytes": tally["purged_bytes"],
        "unsubscribes": unsubs, "rule_runs": rule_runs, "top_rule": top_rule,
    }
    return out


def build(acc, year: int | None, tz: int) -> dict:
    with acc.lock:
        mails = list(acc.index.values())
    name = acc.name or accounts.default_name()
    return compute(
        mails, year, tz, int(time.time()),
        statsmod.load(name)["actions"],
        auditlog.load(name, 0, 10**9)["entries"],
        {r["id"]: r.get("name", "") for r in rulesmod.load_rules()})
