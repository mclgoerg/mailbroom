"""FastAPI app: JSON API under /api/*, static React bundle everywhere else."""

from __future__ import annotations

import asyncio
import csv
import io
import json
from pathlib import Path

import logging
import os
import secrets

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import (FileResponse, JSONResponse, RedirectResponse,
                               StreamingResponse)
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import accounts as accountsmod
from . import aihelper
from . import config as cfgmod
from . import mailops
from . import rules as rulesmod
from . import stats as statsmod
from . import unsub
from . import verdictstore
from .mailops import GROUPINGS

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S")

from contextlib import asynccontextmanager


@asynccontextmanager
async def _lifespan(app: FastAPI):
    rulesmod.start_scheduler()
    yield

app = FastAPI(title="mailbroom", docs_url=None, redoc_url=None,
              lifespan=_lifespan)

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

# Optional shared-secret auth for deployments without a reverse-proxy auth
# layer. Set AUTH_TOKEN, then open the app once as /?token=<value> (stores a
# cookie) or send `Authorization: Bearer <value>` on API calls.
AUTH_TOKEN = os.environ.get("AUTH_TOKEN", "")
_AUTH_COOKIE = "pmc_token"


@app.middleware("http")
async def _auth(request: Request, call_next):
    if not AUTH_TOKEN:
        return await call_next(request)
    query_token = request.query_params.get("token", "")
    if query_token and secrets.compare_digest(query_token, AUTH_TOKEN):
        resp = RedirectResponse(request.url.path or "/")
        resp.set_cookie(_AUTH_COOKIE, AUTH_TOKEN, httponly=True,
                        samesite="strict", max_age=30 * 86400)
        return resp
    header = request.headers.get("authorization", "")
    bearer = header.removeprefix("Bearer ").strip()
    supplied = request.cookies.get(_AUTH_COOKIE, "") or bearer
    if supplied and secrets.compare_digest(supplied, AUTH_TOKEN):
        return await call_next(request)
    return JSONResponse({"detail": "unauthorized — open /?token=<AUTH_TOKEN> "
                         "or send a Bearer token"}, status_code=401)


class GroupingBody(BaseModel):
    grouping: str = "sender"


class DeleteBody(BaseModel):
    grouping: str = "sender"
    keys: list[str] = Field(min_length=1)
    action: str = "trash"          # trash | archive | move | mark_read
    dest: str = ""                 # raw folder name, for action == "move"
    force: bool = False            # trash protected groups anyway


class DeleteMessagesBody(BaseModel):
    items: list[tuple[str, int]] = Field(min_length=1)
    action: str = "trash"
    dest: str = ""


class UndoBody(BaseModel):
    index: int = -1


class AiGroupBody(BaseModel):
    grouping: str = "sender"
    key: str
    offset: int = 0
    limit: int = 200


def _check_grouping(grouping: str) -> None:
    if grouping not in GROUPINGS:
        raise HTTPException(400, "bad grouping")


def _acc(account: str | None = None):
    """AccountState for ?account=… (None = default); 400 on unknown names."""
    try:
        return accountsmod.get(account)
    except KeyError as exc:
        raise HTTPException(400, str(exc.args[0]))


@app.get("/api/state")
def get_state(account: str | None = Query(None)):
    return mailops.public_state(_acc(account))


@app.post("/api/scan")
def post_scan(account: str | None = Query(None)):
    try:
        mailops.start_scan(_acc(account))
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    return {"ok": True}


@app.get("/api/group")
def get_group(grouping: str = Query("sender"), key: str = Query(...),
              account: str | None = Query(None)):
    _check_grouping(grouping)
    return mailops.group_mails(grouping, key, acc=_acc(account))


@app.get("/api/message")
def get_message(folder: str = Query(...), uid: int = Query(...),
                account: str | None = Query(None)):
    acc = _acc(account)
    try:
        return mailops.fetch_message(folder, uid, acc)
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


@app.post("/api/delete")
def post_delete(body: DeleteBody, account: str | None = Query(None)):
    _check_grouping(body.grouping)
    acc = _acc(account)
    try:
        return mailops.delete_groups(body.grouping, body.keys,
                                     body.action, body.dest, body.force,
                                     acc=acc)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


@app.post("/api/delete_messages")
def post_delete_messages(body: DeleteMessagesBody,
                         account: str | None = Query(None)):
    acc = _acc(account)
    try:
        return mailops.delete_messages([list(i) for i in body.items],
                                       body.action, body.dest, acc=acc)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


@app.post("/api/ai")
def post_ai(body: GroupingBody, account: str | None = Query(None)):
    _check_grouping(body.grouping)
    acc = _acc(account)
    try:
        aihelper.start_group_review(body.grouping, acc)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    return {"ok": True}


@app.post("/api/ai_group")
def post_ai_group(body: AiGroupBody, account: str | None = Query(None)):
    _check_grouping(body.grouping)
    acc = _acc(account)
    try:
        return aihelper.ai_group(body.grouping, body.key,
                                 body.offset, body.limit, acc)
    except ValueError as exc:              # e.g. monthly budget reached
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


@app.post("/api/unsubscribe")
def post_unsubscribe(body: AiGroupBody, account: str | None = Query(None)):
    _check_grouping(body.grouping)
    acc = _acc(account)
    try:
        return unsub.unsubscribe(body.grouping, body.key, acc)
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


@app.post("/api/attachments")
def post_attachments(account: str | None = Query(None)):
    """Start the lazy attachment analysis (BODYSTRUCTURE pass)."""
    try:
        mailops.start_att_scan(_acc(account))
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    return {"ok": True}


@app.get("/api/attachments")
def get_attachments(account: str | None = Query(None)):
    return mailops.attachments_list(acc=_acc(account))


@app.get("/api/duplicates")
def get_duplicates(account: str | None = Query(None)):
    return mailops.duplicates_list(acc=_acc(account))


@app.get("/api/stats")
def get_stats(account: str | None = Query(None)):
    acc = _acc(account)
    history = statsmod.load(acc.name)
    return {**mailops.index_stats(acc),
            "scans": history["scans"][-30:],
            "actions": history["actions"]}


class RuleBody(BaseModel):
    name: str = ""
    grouping: str = "sender"
    query: str = ""
    action: str = "trash"
    dest: str = ""
    account: str | None = None     # None = default account
    schedule: str = "manual"
    mode: str | None = None        # only honoured on update


@app.get("/api/rules")
def get_rules():
    return {"rules": rulesmod.load_rules()}


@app.post("/api/rules")
def post_rules(body: RuleBody):
    try:
        return rulesmod.create_rule(body.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.post("/api/rules/{rule_id}")
def post_rule_update(rule_id: str, body: dict):
    try:
        return rulesmod.update_rule(rule_id, body)
    except KeyError:
        raise HTTPException(404, "unknown rule")
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.delete("/api/rules/{rule_id}")
def delete_rule(rule_id: str):
    try:
        rulesmod.delete_rule(rule_id)
    except KeyError:
        raise HTTPException(404, "unknown rule")
    return {"ok": True}


@app.post("/api/rules/{rule_id}/run")
def post_rule_run(rule_id: str):
    """Manual trigger; reuses the current scan when one is loaded."""
    try:
        return rulesmod.run_rule(rule_id, rescan=False)
    except KeyError:
        raise HTTPException(404, "unknown rule")
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))


class ProtectBody(BaseModel):
    entry: str                     # "user@example.com" or "@example.com"
    on: bool = True


@app.post("/api/protect")
def post_protect(body: ProtectBody):
    try:
        protected = cfgmod.set_protected(body.entry, body.on)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    logging.getLogger("pmc.mail").info(
        "protected list %s %r (%d entries)",
        "add" if body.on else "remove", body.entry.strip().lower(),
        len(protected))
    return {"protected": protected}


@app.post("/api/undo")
def post_undo(body: UndoBody, account: str | None = Query(None)):
    acc = _acc(account)
    try:
        return mailops.undo_last(body.index, acc)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


class TrashRestoreBody(BaseModel):
    uids: list[int] = Field(min_length=1)
    dest: str
    uv: int = 0


@app.get("/api/trash")
def get_trash(account: str | None = Query(None)):
    acc = _acc(account)
    try:
        return mailops.trash_list(acc=acc)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


@app.post("/api/trash/restore")
def post_trash_restore(body: TrashRestoreBody,
                       account: str | None = Query(None)):
    acc = _acc(account)
    try:
        return mailops.trash_restore(body.uids, body.dest, body.uv, acc)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


@app.post("/api/empty_trash")
def post_empty_trash(account: str | None = Query(None)):
    acc = _acc(account)
    try:
        return mailops.empty_trash(acc)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


class CancelBody(BaseModel):
    target: str  # "scan" | "ai" | "delete"


@app.post("/api/cancel")
def post_cancel(body: CancelBody, account: str | None = Query(None)):
    acc = _acc(account)
    try:
        mailops.request_cancel(body.target, acc)
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))
    return {"ok": True}


@app.post("/api/notice/clear")
def post_notice_clear(account: str | None = Query(None)):
    acc = _acc(account)
    with acc.lock:
        acc.state["notice"] = None
    return {"ok": True}


@app.post("/api/test_connection")
def post_test_connection(account: str | None = Query(None)):
    """Onboarding helper: can we reach and log into the IMAP server?"""
    acc = _acc(account)
    im = cfgmod.account_imap(acc.name)
    if not im["password"]:
        raise HTTPException(400, "no password configured")
    try:
        conn = mailops.connect(im)
        try:
            n = len(mailops.list_folders(conn))
        finally:
            try:
                conn.logout()
            except Exception:
                pass
    except Exception as exc:
        raise HTTPException(502, f"{type(exc).__name__}: {exc}")
    return {"ok": True, "folders": n}


@app.get("/api/folders")
def get_folders(account: str | None = Query(None)):
    """Live folder list with exclusion flags, for the settings picker."""
    acc = _acc(account)
    cfg = cfgmod.load_config()
    try:
        conn = mailops.connect(cfgmod.account_imap(acc.name))
        try:
            names = mailops.list_folders(conn)
            roles = mailops.folder_roles(conn, acc)
        finally:
            try:
                conn.logout()
            except Exception:
                pass
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")
    rules = cfgmod.account_imap(acc.name).get("excluded_folders") or []
    role_of = {name: role for role, name in roles.items()}
    return {
        "folders": [
            {"raw": f, "name": mailops.decode_mutf7(f),
             "role": role_of.get(f),
             "excluded": role_of.get(f) in mailops.EXCLUDED_ROLES
             or mailops.excluded(f, rules)
             or mailops.excluded(mailops.decode_mutf7(f), rules)}
            for f in names],
        "wildcards": [r for r in rules if r.strip().endswith("*")],
    }


@app.get("/api/search")
def get_search(q: str = Query(...), account: str | None = Query(None)):
    return mailops.search_mails(q, acc=_acc(account))


@app.get("/api/export")
def get_export(grouping: str = Query("sender"),
               account: str | None = Query(None)):
    _check_grouping(grouping)
    acc = _acc(account)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["key", "label", "mails", "size_bytes", "unread", "first",
                "last", "tags", "ai_verdict", "ai_reason"])
    with acc.lock:
        recs = sorted(acc.state["groups"][grouping].values(),
                      key=lambda r: -r["count"])
        for r in recs:
            w.writerow([r["key"], r["label"], r["count"], r["size"],
                        r["unread"], r["first"], r["last"],
                        " ".join(r["tags"]),
                        r["ai"]["verdict"] if r["ai"] else "",
                        r["ai"]["reason"] if r["ai"] else ""])
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition":
                 f'attachment; filename="mail-groups-{grouping}.csv"'})


@app.get("/api/export_config")
def get_export_config():
    """Portable backup of settings + learned state. NO secrets: the IMAP
    password and AI API key never leave the server."""
    cfg = cfgmod.load_config()
    data = {
        "version": 2, "app": "mailbroom",
        "config": {
            "accounts": {n: {k: v for k, v in b.items() if k != "password"}
                         for n, b in cfg["accounts"].items()},
            "protected": cfgmod.normalize_protected(cfg.get("protected")),
            "categories": cfg.get("categories") or {},
            "ai": {k: v for k, v in cfg["ai"].items() if k != "api_key"},
        },
        "rules": rulesmod.load_rules(),
        "verdicts": verdictstore.load(),
        "replied": {n: sorted(mailops.load_replied(accountsmod.get(n)))
                    for n in accountsmod.names()},
    }
    return StreamingResponse(
        iter([json.dumps(data, indent=1)]), media_type="application/json",
        headers={"Content-Disposition":
                 'attachment; filename="mailcleaner-config.json"'})


@app.post("/api/import_config")
def post_import_config(body: dict):
    """Apply an exported backup. Secrets are never importable; imported
    rules are forced back to report mode (safety floor)."""
    c = body.get("config") or {}
    update = {k: c[k] for k in ("accounts", "imap", "excluded_folders",
                                "protected", "categories", "ai") if k in c}
    if isinstance(update.get("imap"), dict):        # v1 backup: one account
        update["imap"].pop("password", None)
    if isinstance(update.get("accounts"), dict):
        for b in update["accounts"].values():
            if isinstance(b, dict):
                b.pop("password", None)
    if isinstance(update.get("ai"), dict):
        update["ai"].pop("api_key", None)
    try:
        cfgmod.update_config(update)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    nrules = 0
    if isinstance(body.get("rules"), list):
        for r in rulesmod.load_rules():
            rulesmod.delete_rule(r["id"])
        for r in body["rules"]:
            if not isinstance(r, dict):
                continue
            try:
                rulesmod.create_rule(r)      # always lands in report mode
                nrules += 1
            except ValueError:
                pass

    def _import_groupings(entries: dict, account: str | None) -> int:
        n = 0
        for grouping, verd in entries.items():
            if grouping in GROUPINGS and isinstance(verd, dict):
                clean = {k: v for k, v in verd.items()
                         if isinstance(v, dict) and "verdict" in v}
                verdictstore.save(grouping, clean, account)
                n += len(clean)
        return n

    nverdicts = 0
    verdicts = body.get("verdicts")
    if isinstance(verdicts, dict):
        mails = verdicts.get("_mails")
        if isinstance(mails, dict):
            clean = {k: v for k, v in mails.items()
                     if v in ("delete_safe", "review", "keep")}
            verdictstore.save_mails(clean)
            nverdicts += len(clean)
        if isinstance(verdicts.get("accounts"), dict):   # v2 backup
            known = set(accountsmod.names())
            for name, entries in verdicts["accounts"].items():
                if name in known and isinstance(entries, dict):
                    nverdicts += _import_groupings(entries, name)
        else:                                            # v1: default account
            nverdicts += _import_groupings(verdicts, None)

    def _import_replied(acc, entries: list) -> int:
        mailops.load_replied(acc)
        addrs = {str(a).strip().lower() for a in entries
                 if isinstance(a, str) and "@" in a}
        new = len(addrs - acc.replied)
        acc.replied.update(addrs)
        mailops.save_replied(acc)
        return new

    nreplied = 0
    replied = body.get("replied")
    if isinstance(replied, list):                        # v1: default account
        nreplied = _import_replied(accountsmod.get(), replied)
    elif isinstance(replied, dict):                      # v2: per account
        known = set(accountsmod.names())
        for name, entries in replied.items():
            if name in known and isinstance(entries, list):
                nreplied += _import_replied(accountsmod.get(name), entries)

    logging.getLogger("pmc.mail").info(
        "config import: %d rules, %d verdicts, %d replied addrs",
        nrules, nverdicts, nreplied)
    return {"ok": True, "rules": nrules, "verdicts": nverdicts,
            "replied": nreplied}


@app.get("/api/events")
async def get_events(account: str | None = Query(None)):
    """Server-sent events: streams ONE account's state (~1/s)."""
    acc = _acc(account)

    async def gen():
        while True:
            yield f"data: {json.dumps(mailops.public_state(acc))}\n\n"
            await asyncio.sleep(1.0)
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


@app.get("/api/config")
def get_config():
    return cfgmod.masked_config(cfgmod.load_config())


@app.post("/api/config")
def post_config(body: dict):
    if body.get("reset_ai_stats"):
        cfgmod.reset_stats()
    if body.get("clear_ai_verdicts"):
        verdictstore.clear()
        mailops.clear_ai_marks()
    try:
        cfg = cfgmod.update_config(body)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if body.get("delete_account"):
        accountsmod.drop(str(body["delete_account"]))
    if isinstance(body.get("rename_account"), dict):
        # The config rename succeeded — carry every per-account artifact
        # (runtime state, verdicts, replied cache, stats, rules) along.
        old = str(body["rename_account"].get("from") or "")
        new = str(body["rename_account"].get("to") or "").strip()[:60]
        if old != new:
            accountsmod.rename(old, new)
            verdictstore.rename_account(old, new)
            mailops.rename_replied_account(old, new)
            statsmod.rename_account(old, new)
            rulesmod.rename_account(old, new)
            logging.getLogger("pmc.mail").info(
                "account renamed: %r -> %r (state, verdicts, replied, "
                "stats, rules migrated)", old, new)
    return cfgmod.masked_config(cfg)


# Static React bundle (single-page app: unknown paths fall back to index.html)
if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"),
              name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        # Containment check: `path` is percent-decoded and may contain ../ or
        # be absolute (pathlib discards the left side then) — never serve
        # anything that resolves outside the static dir.
        file = (STATIC_DIR / path).resolve()
        if path and file.is_relative_to(STATIC_DIR) and file.is_file():
            return FileResponse(file)
        return FileResponse(STATIC_DIR / "index.html")
