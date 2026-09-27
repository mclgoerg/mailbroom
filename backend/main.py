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

app = FastAPI(title="proton-mail-cleaner", docs_url=None, redoc_url=None,
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


@app.get("/api/state")
def get_state():
    return mailops.public_state()


@app.post("/api/scan")
def post_scan():
    try:
        mailops.start_scan()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    return {"ok": True}


@app.get("/api/group")
def get_group(grouping: str = Query("sender"), key: str = Query(...)):
    _check_grouping(grouping)
    return mailops.group_mails(grouping, key)


@app.get("/api/message")
def get_message(folder: str = Query(...), uid: int = Query(...)):
    try:
        return mailops.fetch_message(folder, uid)
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


@app.post("/api/delete")
def post_delete(body: DeleteBody):
    _check_grouping(body.grouping)
    try:
        return mailops.delete_groups(body.grouping, body.keys,
                                     body.action, body.dest, body.force)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


@app.post("/api/delete_messages")
def post_delete_messages(body: DeleteMessagesBody):
    try:
        return mailops.delete_messages([list(i) for i in body.items],
                                       body.action, body.dest)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


@app.post("/api/ai")
def post_ai(body: GroupingBody):
    _check_grouping(body.grouping)
    try:
        aihelper.start_group_review(body.grouping)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    return {"ok": True}


@app.post("/api/ai_group")
def post_ai_group(body: AiGroupBody):
    _check_grouping(body.grouping)
    try:
        return aihelper.ai_group(body.grouping, body.key,
                                 body.offset, body.limit)
    except ValueError as exc:              # e.g. monthly budget reached
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


@app.post("/api/unsubscribe")
def post_unsubscribe(body: AiGroupBody):
    _check_grouping(body.grouping)
    try:
        return unsub.unsubscribe(body.grouping, body.key)
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


@app.post("/api/attachments")
def post_attachments():
    """Start the lazy attachment analysis (BODYSTRUCTURE pass)."""
    try:
        mailops.start_att_scan()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    return {"ok": True}


@app.get("/api/attachments")
def get_attachments():
    return mailops.attachments_list()


@app.get("/api/duplicates")
def get_duplicates():
    return mailops.duplicates_list()


@app.get("/api/stats")
def get_stats():
    history = statsmod.load()
    return {**mailops.index_stats(),
            "scans": history["scans"][-30:],
            "actions": history["actions"]}


class RuleBody(BaseModel):
    name: str = ""
    grouping: str = "sender"
    query: str = ""
    action: str = "trash"
    dest: str = ""
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
def post_undo(body: UndoBody):
    try:
        return mailops.undo_last(body.index)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


class TrashRestoreBody(BaseModel):
    uids: list[int] = Field(min_length=1)
    dest: str
    uv: int = 0


@app.get("/api/trash")
def get_trash():
    try:
        return mailops.trash_list()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


@app.post("/api/trash/restore")
def post_trash_restore(body: TrashRestoreBody):
    try:
        return mailops.trash_restore(body.uids, body.dest, body.uv)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


@app.post("/api/empty_trash")
def post_empty_trash():
    try:
        return mailops.empty_trash()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


class CancelBody(BaseModel):
    target: str  # "scan" | "ai" | "delete"


@app.post("/api/cancel")
def post_cancel(body: CancelBody):
    try:
        mailops.request_cancel(body.target)
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))
    return {"ok": True}


@app.post("/api/notice/clear")
def post_notice_clear():
    with mailops.STATE_LOCK:
        mailops.STATE["notice"] = None
    return {"ok": True}


@app.get("/api/folders")
def get_folders():
    """Live folder list with exclusion flags, for the settings picker."""
    cfg = cfgmod.load_config()
    try:
        conn = mailops.connect(cfg)
        try:
            names = mailops.list_folders(conn)
        finally:
            try:
                conn.logout()
            except Exception:
                pass
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")
    rules = cfg["excluded_folders"]
    return {
        "folders": [
            {"raw": f, "name": mailops.decode_mutf7(f),
             "excluded": mailops.excluded(f, rules)
             or mailops.excluded(mailops.decode_mutf7(f), rules)}
            for f in names],
        "wildcards": [r for r in rules if r.strip().endswith("*")],
    }


@app.get("/api/search")
def get_search(q: str = Query(...)):
    return mailops.search_mails(q)


@app.get("/api/export")
def get_export(grouping: str = Query("sender")):
    _check_grouping(grouping)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["key", "label", "mails", "size_bytes", "unread", "first",
                "last", "tags", "ai_verdict", "ai_reason"])
    with mailops.STATE_LOCK:
        recs = sorted(mailops.STATE["groups"][grouping].values(),
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


@app.get("/api/events")
async def get_events():
    """Server-sent events: streams the app state (~1/s) while connected."""
    async def gen():
        while True:
            yield f"data: {json.dumps(mailops.public_state())}\n\n"
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
