"""FastAPI app: JSON API under /api/*, static React bundle everywhere else."""

from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
from pathlib import Path
from typing import Literal

import logging
import os

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import (FileResponse, JSONResponse, RedirectResponse,
                               StreamingResponse)
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import accounts as accountsmod
from . import aihelper
from . import auditlog
from . import auth as authmod
from . import autoscan as autoscanmod
from . import config as cfgmod
from . import digest as digestmod
from . import knownsenders
from . import mailops
from . import oauthflow
from . import pinstore
from . import presets as presetsmod
from . import rules as rulesmod
from . import stats as statsmod
from . import tenants
from . import unsub
from . import unsubstore
from . import verdictstore
from .mailops import GROUPINGS

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S")

from contextlib import asynccontextmanager


@asynccontextmanager
async def _lifespan(app: FastAPI):
    from . import secretbox
    if not secretbox.enabled():
        logging.getLogger("pmc.secrets").warning(
            "MAILBROOM_SECRET_KEY is not set - IMAP passwords and API keys "
            "are stored in plaintext in /data (they would be readable in "
            "volume backups). Generate a key with `openssl rand -base64 32` "
            "and keep it OUT of the backups.")
    # Show the last scan of every tenant's accounts right away instead of
    # an empty view (safe: moves re-check UIDVALIDITY; undo works by
    # Message-ID).
    for tenant in tenants.known():
        with tenants.use(tenant):
            for name in accountsmod.names():
                mailops.load_snapshot(accountsmod.get(name))
    rulesmod.start_scheduler()
    presetsmod.publish()
    digestmod.start_scheduler()
    autoscanmod.start_scheduler()
    yield

app = FastAPI(title="mailbroom", docs_url=None, redoc_url=None,
              lifespan=_lifespan)

STATIC_DIR = Path(os.environ.get(
    "STATIC_DIR", Path(__file__).resolve().parent.parent / "static"))

SESSION_COOKIE = "pmc_session"

# Reachable without a session: the login endpoints themselves plus the
# auth-mode probe the login screen needs.
_PUBLIC_API = {"/api/auth", "/api/login", "/api/logout",
               "/api/oidc/login", "/api/oidc/callback", "/api/version"}


def _session_sub(request: Request) -> str | None:
    return authmod.verify_session(request.cookies.get(SESSION_COOKIE, ""))


def _session_ok(request: Request) -> bool:
    return _session_sub(request) is not None


def _resolve_tenant(mode: str, auth_cfg: dict, sub: str) -> tenants.Tenant:
    """The workspace of a verified session subject. Only OIDC mode is
    multi-tenant; the admin identity claims the pre-tenancy DEFAULT
    workspace, everyone else gets their own directory."""
    if mode != "oidc":
        return tenants.DEFAULT
    admin = (auth_cfg.get("admin") or "").strip().lower()
    if sub.strip().lower() == admin:
        return tenants.DEFAULT
    return tenants.for_subject(sub)


@app.middleware("http")
async def _auth(request: Request, call_next):
    tenants.activate(tenants.DEFAULT, "")     # per-request baseline

    auth_cfg = cfgmod.load_server()["auth"]
    mode = auth_cfg["mode"]
    if mode == "none":
        return await call_next(request)

    sub = _session_sub(request)
    # A password-mode session ("password" subject) does not carry over
    # into OIDC mode - it has no identity to map to a tenant.
    if mode == "oidc" and sub == "password":
        sub = None
    if sub:
        tenants.activate(_resolve_tenant(mode, auth_cfg, sub), sub)

    # Native login active: the SPA bundle and login endpoints stay public,
    # everything under /api/ needs a session.
    path = request.url.path
    if not path.startswith("/api/") or path in _PUBLIC_API:
        return await call_next(request)
    if sub:
        return await call_next(request)
    return JSONResponse({"detail": "login required"}, status_code=401)


def _external_base(request: Request) -> str:
    """Origin as the BROWSER sees it (honours the reverse proxy)."""
    cfg_base = cfgmod.load_config()["auth"]["oidc"].get("redirect_base")
    if cfg_base:
        return cfg_base.rstrip("/")
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host",
                               request.headers.get("host", ""))
    return f"{proto}://{host}"


def _set_session(resp, request: Request, sub: str):
    secure = _external_base(request).startswith("https://")
    resp.set_cookie(SESSION_COOKIE, authmod.make_session(sub),
                    httponly=True, samesite="lax", secure=secure,
                    max_age=authmod.SESSION_MAX_AGE)


class LoginBody(BaseModel):
    password: str


@app.get("/api/auth")
def get_auth(request: Request):
    """Public probe for the login screen; identity for the header."""
    mode = cfgmod.load_server()["auth"]["mode"]
    sub = _session_sub(request)
    if mode == "oidc" and sub == "password":
        sub = None
    authed = mode == "none" or sub is not None
    out = {"mode": mode, "authed": authed}
    if authed:
        # The middleware already resolved the tenant for this request.
        out["sub"] = sub if mode == "oidc" else ""
        out["is_admin"] = tenants.current().is_default
    return out


_build_id: str | None = None


@app.get("/api/version")
def get_version():
    """Public, unauthenticated: lets an already-open tab/PWA detect that a
    newer frontend build is live (see frontend's update-check poll) without
    depending on the browser ever re-fetching index.html on its own - an
    installed PWA (no service worker here) can otherwise keep a stale app
    shell indefinitely regardless of HTTP caching headers."""
    global _build_id
    if _build_id is None:
        idx = STATIC_DIR / "index.html"
        _build_id = (hashlib.sha256(idx.read_bytes()).hexdigest()[:12]
                     if idx.is_file() else "dev")
    return JSONResponse({"build": _build_id},
                         headers={"Cache-Control": "no-store"})


@app.post("/api/login")
async def post_login(body: LoginBody, request: Request):
    cfg = cfgmod.load_config()
    if cfg["auth"]["mode"] != "password":
        raise HTTPException(400, "password login is not enabled")
    if not authmod.verify_password(body.password,
                                   cfg["auth"]["password_hash"]):
        logging.getLogger("pmc.auth").warning(
            "failed login from %s", request.client.host
            if request.client else "?")
        await asyncio.sleep(0.5)          # soften brute force
        raise HTTPException(401, "wrong password")
    resp = JSONResponse({"ok": True})
    _set_session(resp, request, "password")
    logging.getLogger("pmc.auth").info("password login ok")
    return resp


@app.post("/api/logout")
def post_logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(SESSION_COOKIE)
    return resp


_PKCE_COOKIE = "pmc_oidc_pkce"


@app.get("/api/oidc/login")
def get_oidc_login(request: Request):
    cfg = cfgmod.load_config()
    if cfg["auth"]["mode"] != "oidc":
        raise HTTPException(400, "OIDC login is not enabled")
    redirect = _external_base(request) + "/api/oidc/callback"
    verifier = authmod.make_verifier()
    try:
        url = authmod.auth_url(cfg["auth"]["oidc"], redirect,
                               authmod.make_state(), verifier)
    except Exception as exc:
        raise HTTPException(502, f"IdP discovery failed: {exc}")
    resp = RedirectResponse(url)
    # PKCE verifier for the callback leg. Lax still sends it on the IdP's
    # top-level redirect back to us; it never appears in any URL.
    resp.set_cookie(_PKCE_COOKIE, verifier, httponly=True, samesite="lax",
                    secure=_external_base(request).startswith("https://"),
                    max_age=authmod.STATE_MAX_AGE)
    return resp


@app.get("/api/oidc/callback")
def get_oidc_callback(request: Request, code: str = Query(""),
                      state: str = Query(""), error: str = Query(""),
                      error_description: str = Query("")):
    cfg = cfgmod.load_config()
    if cfg["auth"]["mode"] != "oidc":
        raise HTTPException(400, "OIDC login is not enabled")
    if error:      # the IdP rejected the authorization request - say why
        logging.getLogger("pmc.auth").warning(
            "OIDC login rejected by the IdP: %s (%s)",
            error, error_description)
        raise HTTPException(
            502, f"the identity provider rejected the login: "
                 f"{error_description or error}")
    if not code or not authmod.verify_state(state):
        raise HTTPException(400, "invalid or expired login state - "
                            "try signing in again")
    redirect = _external_base(request) + "/api/oidc/callback"
    verifier = request.cookies.get(_PKCE_COOKIE, "")
    try:
        claims = authmod.exchange_code(cfg["auth"]["oidc"], redirect, code,
                                       verifier)
    except Exception as exc:
        raise HTTPException(502, f"token exchange failed: {exc}")
    sub = authmod.allowed_subject(claims,
                                  cfg["auth"]["oidc"].get("allowed") or [])
    if not sub:
        logging.getLogger("pmc.auth").warning(
            "OIDC login rejected for %r (not in allow-list)",
            claims.get("email") or claims.get("sub"))
        raise HTTPException(403, "this account is not allowed to sign in")
    # No admin configured yet: the first allowed identity to sign in
    # claims the pre-tenancy workspace (set OIDC_ADMIN to pin it upfront).
    if cfgmod.claim_admin(sub):
        logging.getLogger("pmc.auth").warning(
            "OIDC admin claimed by %s - this identity now owns the "
            "existing workspace and the server settings", sub)
    resp = RedirectResponse("/")
    resp.delete_cookie(_PKCE_COOKIE)          # one roundtrip, one verifier
    _set_session(resp, request, sub)
    logging.getLogger("pmc.auth").info("OIDC login ok: %s", sub)
    return resp


# ------------------------------------------------------ IMAP account OAuth
#
# Connecting a mail ACCOUNT to Gmail/Outlook via OAuth, distinct from the
# OIDC login above (that authenticates a Mailbroom user; this authorizes
# XOAUTH2 access to one IMAP account). Requires an existing session - the
# tenant is whatever the middleware already resolved for this request.

_OAUTH_PENDING_COOKIE = "pmc_oauth_pending"


def _oauth_account_imap(account: str) -> dict:
    try:
        return cfgmod.account_imap(account)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.get("/api/oauth/imap/login")
def get_oauth_imap_login(request: Request, account: str = Query(...),
                         provider: str = Query(...)):
    if provider not in oauthflow.PROVIDERS:
        raise HTTPException(400, f"unknown provider {provider!r}")
    im = _oauth_account_imap(account)
    oauth = im.get("oauth") or {}
    client_id = oauth.get("client_id") if oauth.get("provider") == provider \
        else ""
    if not client_id:
        raise HTTPException(
            400, "enter this account's OAuth client ID first")
    redirect = _external_base(request) + "/api/oauth/imap/callback"
    verifier = authmod.make_verifier()
    url = oauthflow.auth_url(provider, client_id, redirect,
                             authmod.make_state(), verifier)
    resp = RedirectResponse(url)
    pending = json.dumps({"account": account, "provider": provider,
                          "verifier": verifier})
    resp.set_cookie(_OAUTH_PENDING_COOKIE, pending, httponly=True,
                    samesite="lax",
                    secure=_external_base(request).startswith("https://"),
                    max_age=authmod.STATE_MAX_AGE)
    return resp


@app.get("/api/oauth/imap/callback")
def get_oauth_imap_callback(request: Request, code: str = Query(""),
                            state: str = Query(""), error: str = Query(""),
                            error_description: str = Query("")):
    if error:
        raise HTTPException(
            502, f"the identity provider rejected the connection: "
                 f"{error_description or error}")
    if not code or not authmod.verify_state(state):
        raise HTTPException(400, "invalid or expired connection attempt - "
                            "try again")
    try:
        pending = json.loads(
            request.cookies.get(_OAUTH_PENDING_COOKIE, "") or "{}")
        account, provider = pending["account"], pending["provider"]
        verifier = pending["verifier"]
    except (json.JSONDecodeError, KeyError):
        raise HTTPException(400, "invalid or expired connection attempt - "
                            "try again")
    im = _oauth_account_imap(account)
    oauth = im.get("oauth") or {}
    client_id = oauth.get("client_id", "")
    client_secret = oauth.get("client_secret", "")
    redirect = _external_base(request) + "/api/oauth/imap/callback"
    try:
        tokens = oauthflow.exchange_code(provider, client_id, client_secret,
                                         redirect, code, verifier)
    except Exception as exc:
        raise HTTPException(502, f"token exchange failed: {exc}")
    cfgmod.save_oauth(account, {"provider": provider, "client_id": client_id,
                                "client_secret": client_secret, **tokens})
    logging.getLogger("pmc.oauth").info(
        "IMAP OAuth connected: account=%r provider=%s", account, provider)
    resp = RedirectResponse("/")
    resp.delete_cookie(_OAUTH_PENDING_COOKIE)
    return resp


@app.post("/api/oauth/imap/device/start")
def post_oauth_imap_device_start(account: str = Query(...)):
    """Microsoft device-code flow, using the server's shared public
    client - no per-user app registration needed."""
    _oauth_account_imap(account)   # 400 on an unknown account
    try:
        info = oauthflow.device_start()
    except Exception as exc:
        raise HTTPException(502, str(exc))
    return {"device_code": info["device_code"],
            "user_code": info["user_code"],
            "verification_uri": info.get("verification_uri")
            or info.get("verification_uri_complete", ""),
            "expires_in": info.get("expires_in", 900),
            "interval": info.get("interval", 5)}


@app.post("/api/oauth/imap/device/poll")
def post_oauth_imap_device_poll(account: str = Query(...),
                                device_code: str = Query(...)):
    _oauth_account_imap(account)
    result = oauthflow.device_poll(device_code)
    if result["status"] == "complete":
        cfgmod.save_oauth(account, {k: v for k, v in result.items()
                                    if k != "status"})
        logging.getLogger("pmc.oauth").info(
            "IMAP OAuth connected: account=%r provider=microsoft (device "
            "code)", account)
    return result


@app.post("/api/oauth/imap/disconnect")
def post_oauth_imap_disconnect(account: str = Query(...)):
    _oauth_account_imap(account)
    cfgmod.update_config({"account": account, "imap": {
        "oauth": {"disconnect": True}}})
    return {"ok": True}


class GroupingBody(BaseModel):
    grouping: str = "sender"
    keys: list[str] | None = None    # None = every unrated group (default)


class DeleteBody(BaseModel):
    grouping: str = "sender"
    keys: list[str] = Field(min_length=1)
    action: str = "trash"          # trash | archive | move | mark_read
    dest: str = ""                 # raw folder name, for action == "move"
    force: bool = False            # trash protected groups anyway
    keep_latest: int | None = Field(None, ge=1)       # keep N newest mails
    older_than_days: int | None = Field(None, ge=1)   # act only past N days


class DeleteMessagesBody(BaseModel):
    items: list[tuple[str, int]] = Field(min_length=1)
    action: str = "trash"
    dest: str = ""
    force: bool = False            # confirmed: act on pinned mails too


class UndoBody(BaseModel):
    index: int = -1


class AiGroupBody(BaseModel):
    grouping: str = "sender"
    key: str
    offset: int = 0
    limit: int = 200
    # Restrict rating to exactly these (folder, uid) mails instead of the
    # whole group - the detail panel's "rate only what I selected" mode.
    uids: list[tuple[str, int]] | None = None


class UnsubBulkBody(BaseModel):
    grouping: str = "sender"
    keys: list[str] = Field(min_length=1)


class UnsubAckBody(BaseModel):
    addr: str
    done: bool = True              # false = forget the record, try again


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


class MessagesBody(BaseModel):
    items: list[list] = Field(max_length=mailops.MESSAGES_BATCH_MAX)


@app.post("/api/messages")
def post_messages(body: MessagesBody, account: str | None = Query(None)):
    """Several mails' text over one IMAP connection (the conversation
    reader); see mailops.fetch_messages."""
    acc = _acc(account)
    try:
        return {"messages": mailops.fetch_messages(body.items, acc)}
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


@app.get("/api/thread")
def get_thread(folder: str = Query(...), uid: int = Query(...),
               account: str | None = Query(None)):
    """The conversation a scanned mail belongs to, oldest first (including
    the user's own replies found in Sent) - see mailops.thread_conversation."""
    acc = _acc(account)
    try:
        return mailops.thread_conversation(folder, uid, acc)
    except RuntimeError as exc:
        raise HTTPException(404, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


@app.post("/api/delete")
def post_delete(body: DeleteBody, account: str | None = Query(None)):
    _check_grouping(body.grouping)
    acc = _acc(account)
    try:
        return mailops.delete_groups(body.grouping, body.keys,
                                     body.action, body.dest, body.force,
                                     body.keep_latest, body.older_than_days,
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
                                       body.action, body.dest, acc=acc,
                                       force=body.force)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


class PinBody(BaseModel):
    folder: str
    uid: int
    pinned: bool = True


@app.post("/api/pin")
def post_pin(body: PinBody, account: str | None = Query(None)):
    """Pin/unpin ONE mail ("Protect this mail"): a pinned mail is skipped by
    every bulk action, rule and AI pick. Stored per account by Message-ID."""
    acc = _acc(account)
    try:
        return mailops.set_pin(body.folder, body.uid, body.pinned, acc)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


class PinGroupBody(BaseModel):
    grouping: str
    key: str
    pinned: bool = True


@app.post("/api/pin_group")
def post_pin_group(body: PinGroupBody, account: str | None = Query(None)):
    """Pin/unpin every mail currently in one group."""
    _check_grouping(body.grouping)
    acc = _acc(account)
    try:
        return mailops.set_group_pin(body.grouping, body.key, body.pinned,
                                     acc)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


@app.post("/api/ai")
def post_ai(body: GroupingBody, account: str | None = Query(None)):
    _check_grouping(body.grouping)
    acc = _acc(account)
    try:
        aihelper.start_group_review(body.grouping, acc, body.keys)
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
                                 body.offset, body.limit, acc,
                                 only=set(body.uids) if body.uids else None)
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


@app.post("/api/unsubscribe_bulk")
def post_unsubscribe_bulk(body: UnsubBulkBody,
                          account: str | None = Query(None)):
    """Unsubscribe from every sender of the selected groups, in the
    background (see unsub.start_bulk)."""
    _check_grouping(body.grouping)
    acc = _acc(account)
    try:
        return unsub.start_bulk(body.grouping, body.keys, acc)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")


@app.post("/api/unsubscribe/ack")
def post_unsubscribe_ack(body: UnsubAckBody,
                         account: str | None = Query(None)):
    """Confirm a sender whose unsubscribe needed a manual page, or (with
    done=false) forget a record so the sender can be tried again."""
    acc = _acc(account)
    if not body.addr.strip():
        raise HTTPException(400, "addr required")
    if body.done:
        return unsub.acknowledge(body.addr, acc)
    return unsub.forget(body.addr, acc)


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


@app.get("/api/admin/stats")
def get_admin_stats():
    """Usage overview over ALL tenants - admin only. Counts, spend and
    disk footprint; never account names or mail-derived data."""
    if not cfgmod.is_admin():
        raise HTTPException(403, "admin only")
    return {"tenants": statsmod.admin_overview()}


@app.get("/api/stats")
def get_stats(account: str | None = Query(None)):
    acc = _acc(account)
    history = statsmod.load(acc.name)
    return {**mailops.index_stats(acc),
            "scans": history["scans"][-30:],
            "actions": history["actions"]}


@app.get("/api/audit")
def get_audit(offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=500),
             account: str | None = Query(None)):
    acc = _acc(account)
    return auditlog.load(acc.name, offset, limit)


@app.get("/api/audit/export")
def get_audit_export(account: str | None = Query(None)):
    acc = _acc(account)
    entries = auditlog.load(acc.name, 0, 10**9)["entries"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["ts", "account", "actor", "action", "count", "bytes",
                "label", "outcome", "error"])
    for e in entries:
        w.writerow([e["ts"], e["account"], e["actor"], e["action"],
                    e["count"], e["bytes"], e["label"], e["outcome"],
                    e["error"]])
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition":
                 'attachment; filename="mailbroom-audit-log.csv"'})


@app.post("/api/digest/test")
def post_digest_test(account: str | None = Query(None)):
    """'Send me one now' - verify the digest before enabling its
    schedule. Never advances last_sent (see digest.send_digest)."""
    acc = _acc(account)
    try:
        return digestmod.send_digest(acc.name, test=True)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


class RuleBody(BaseModel):
    name: str = ""
    grouping: str = "sender"
    query: str = ""
    action: str = "trash"
    dest: str = ""
    account: str | None = None     # None = default account
    schedule: str = "manual"
    mode: str | None = None        # only honoured on update
    keep_latest: int | None = None
    older_than_days: int | None = None


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


class PresetBody(BaseModel):
    name: str = ""
    query: str = ""


@app.get("/api/presets")
def get_presets():
    return {"presets": presetsmod.load_presets()}


@app.post("/api/presets")
def post_presets(body: PresetBody, account: str | None = Query(None)):
    try:
        return presetsmod.create_preset(
            {"name": body.name, "query": body.query, "account": account})
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.post("/api/presets/{preset_id}")
def post_preset_update(preset_id: str, body: PresetBody):
    try:
        return presetsmod.update_preset(
            preset_id, {"name": body.name, "query": body.query})
    except KeyError:
        raise HTTPException(404, "unknown preset")
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.delete("/api/presets/{preset_id}")
def delete_preset(preset_id: str):
    try:
        presetsmod.delete_preset(preset_id)
    except KeyError:
        raise HTTPException(404, "unknown preset")
    return {"ok": True}


class BlockBody(BaseModel):
    grouping: str                  # sender | domain
    key: str
    label: str = ""
    trash_existing: bool = False


@app.post("/api/block")
def post_block(body: BlockBody, account: str | None = Query(None)):
    """One-click "Block sender/domain": create a visible, ordinary rule
    that auto-trashes future mail on the daily schedule, optionally also
    trashing the group's existing mail right away. Unblock = delete the
    rule in the Rules modal.

    Rules must report-run at least once before they may execute (the
    usual safety rule - see rules._validate), so this runs one immediate
    report pass and then switches the fresh rule straight to execute."""
    if body.grouping not in ("sender", "domain"):
        raise HTTPException(400, "bad grouping")
    acc = _acc(account)
    check_addr = body.key if body.grouping == "sender" else f"@{body.key}"
    plist = cfgmod.normalize_protected(cfgmod.load_config().get("protected"))
    if cfgmod.is_protected(check_addr, plist):
        raise HTTPException(400, "refusing to block a protected sender")
    query = f"{'from' if body.grouping == 'sender' else 'domain'}:{body.key}"
    if any(r.get("origin") == "block" and r["grouping"] == body.grouping
           and r["query"] == query for r in rulesmod.load_rules()):
        raise HTTPException(400, "already blocked")
    rule = rulesmod.create_rule({
        "name": body.label or body.key, "grouping": body.grouping,
        "query": query, "action": "trash", "schedule": "daily",
        "account": account, "origin": "block"})
    try:
        rulesmod.run_rule(rule["id"], rescan=False)   # satisfies report-first
        rule = rulesmod.update_rule(rule["id"], {"mode": "execute"})
    except Exception as exc:
        rulesmod.delete_rule(rule["id"])
        raise HTTPException(500, f"{type(exc).__name__}: {exc}")
    result: dict = {"rule": rule}
    if body.trash_existing:
        try:
            result["trashed"] = mailops.delete_groups(
                body.grouping, [body.key], "trash", acc=acc)
        except (ValueError, RuntimeError) as exc:
            result["trash_error"] = str(exc)
    return result


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
    target: str  # "scan" | "ai" | "delete" | "atts" | "unsub"


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
        conn = mailops.connect(im, acc.name)
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
        conn = mailops.connect(cfgmod.account_imap(acc.name), acc.name)
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
def get_search(q: str = Query(...),
               scope: Literal["meta", "body"] = Query("meta"),
               account: str | None = Query(None)):
    """{"mails": [...], "notes": [{key, params}]}. scope=body additionally
    asks the IMAP server to look inside message bodies (per-account
    `body_search` setting)."""
    acc = _acc(account)
    if scope == "body":
        if cfgmod.account_imap(acc.name).get("body_search") == "disabled":
            raise HTTPException(
                400, "body search is disabled for this account")
        try:
            return mailops.search_body(q, acc=acc)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(500, f"{type(exc).__name__}: {exc}")
    return {"mails": mailops.search_mails(q, acc=acc), "notes": []}


@app.get("/api/mails")
def get_mails(offset: int = Query(0, ge=0),
              limit: int = Query(100, ge=1, le=1000),
              sort: Literal["date", "size", "sender"] = Query("date"),
              dir: Literal["asc", "desc"] | None = Query(None),
              q: str = Query(""),
              account: str | None = Query(None)):
    """Flat "All mails" view: one page of the scan index as
    {total, offset, mails, ignored}. `q` takes plain words plus the
    per-mail qualifiers age:/size:/att:/from:/domain:/folder:/is:unread|read/
    has:pinned; group-level qualifiers (tag:, ai:, unread:<pct>, eng:, ...)
    do not apply per mail and are echoed back in `ignored`. No IMAP traffic."""
    return mailops.list_mails(offset, limit, sort, dir, q, _acc(account))


@app.get("/api/export")
def get_export(grouping: str = Query("sender"),
               keys: list[str] | None = Query(None),
               account: str | None = Query(None)):
    """CSV of every group in `grouping`, or (when `keys` is given, e.g.
    `?keys=a&keys=b`) just those - the user's current selection instead
    of the whole view."""
    _check_grouping(grouping)
    acc = _acc(account)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["key", "label", "mails", "size_bytes", "unread", "first",
                "last", "tags", "ai_verdict", "ai_reason"])
    with acc.lock:
        all_recs = acc.state["groups"][grouping]
        wanted = all_recs.values() if keys is None \
            else (all_recs[k] for k in keys if k in all_recs)
        recs = sorted(wanted, key=lambda r: -r["count"])
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
        "unsub": unsubstore.load(),
        "replied": {n: sorted(mailops.load_replied(accountsmod.get(n)))
                    for n in accountsmod.names()},
    }
    return StreamingResponse(
        iter([json.dumps(data, indent=1)]), media_type="application/json",
        headers={"Content-Disposition":
                 'attachment; filename="mailcleaner-config.json"'})


@app.post("/api/import_config")
def post_import_config(body: dict):
    """Apply an exported backup (v2 shape). Secrets are never importable;
    imported rules are forced back to report mode (safety floor)."""
    c = body.get("config") or {}
    update = {k: c[k] for k in ("accounts", "protected", "categories", "ai")
              if k in c}
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
        if isinstance(verdicts.get("accounts"), dict):
            known = set(accountsmod.names())
            for name, entries in verdicts["accounts"].items():
                if name in known and isinstance(entries, dict):
                    nverdicts += _import_groupings(entries, name)

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
    if isinstance(replied, dict):                        # per account
        known = set(accountsmod.names())
        for name, entries in replied.items():
            if name in known and isinstance(entries, list):
                nreplied += _import_replied(accountsmod.get(name), entries)

    # Absent in backups taken before bulk unsubscribe existed. Merges (like
    # every other import path) so restoring an older backup never erases
    # unsubscribe records made since.
    nunsub = 0
    if isinstance(body.get("unsub"), dict):
        nunsub = unsubstore.merge_import(body["unsub"],
                                         set(accountsmod.names()))

    logging.getLogger("pmc.mail").info(
        "config import: %d rules, %d verdicts, %d replied addrs, "
        "%d unsubscribed senders", nrules, nverdicts, nreplied, nunsub)
    return {"ok": True, "rules": nrules, "verdicts": nverdicts,
            "replied": nreplied, "unsub": nunsub}


@app.get("/api/events")
async def get_events(account: str | None = Query(None)):
    """Server-sent events: streams ONE account's slim status (~1/s).
    Group lists are NOT included - clients refetch /api/state when the
    payload's groups_rev changes."""
    acc = _acc(account)

    async def gen():
        while True:
            yield f"data: {json.dumps(mailops.public_status(acc))}\n\n"
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
    except PermissionError as exc:
        raise HTTPException(403, str(exc))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if body.get("delete_account"):
        accountsmod.drop(str(body["delete_account"]))
        mailops.drop_snapshot(str(body["delete_account"]))
        unsubstore.drop_account(str(body["delete_account"]))
        presetsmod.drop_account(str(body["delete_account"]))
        digestmod.drop_account(str(body["delete_account"]))
        knownsenders.drop_account(str(body["delete_account"]))
        pinstore.drop_account(str(body["delete_account"]))
        autoscanmod.drop_account(str(body["delete_account"]))
    if isinstance(body.get("rename_account"), dict):
        # The config rename succeeded - carry every per-account artifact
        # (runtime state, verdicts, unsubscribes, replied cache, stats,
        # rules) along.
        old = str(body["rename_account"].get("from") or "")
        new = str(body["rename_account"].get("to") or "").strip()[:60]
        if old != new:
            accountsmod.rename(old, new)
            mailops.rename_snapshot(old, new)
            verdictstore.rename_account(old, new)
            unsubstore.rename_account(old, new)
            mailops.rename_replied_account(old, new)
            statsmod.rename_account(old, new)
            rulesmod.rename_account(old, new)
            presetsmod.rename_account(old, new)
            digestmod.rename_account(old, new)
            knownsenders.rename_account(old, new)
            pinstore.rename_account(old, new)
            autoscanmod.rename_account(old, new)
            auditlog.rename_account(old, new)
            logging.getLogger("pmc.mail").info(
                "account renamed: %r -> %r (state, verdicts, unsubscribes, "
                "replied, stats, rules, presets, digest, known senders, "
                "pins, auto-scan, audit log migrated)", old, new)
    return cfgmod.masked_config(cfg)


# Static React bundle (single-page app: unknown paths fall back to index.html)
if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"),
              name="assets")

    # Resolve the base ONCE: comparing a resolved child against an
    # unresolved (possibly relative or symlinked) base would break the
    # containment check below.
    _STATIC_ROOT = STATIC_DIR.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        # Containment check: `path` is percent-decoded and may contain ../ or
        # be absolute (pathlib discards the left side then) - never serve
        # anything that resolves outside the static dir. CodeQL's
        # py/path-injection sanitizer model does not recognize
        # Path.is_relative_to() as a guard (confirmed against its query
        # source - no built-in or stdlib-modeled sanitizer covers it), so
        # it flags both returns below despite the check actually being
        # correct; test_spa_fallback_is_contained exercises real traversal
        # payloads (../, double-encoded, absolute) and asserts none escape.
        file = (_STATIC_ROOT / path).resolve()
        # codeql[py/path-injection]
        if path and file.is_relative_to(_STATIC_ROOT) and file.is_file():
            # codeql[py/path-injection]
            return FileResponse(file)
        # index.html references the CURRENT build's hashed /assets bundle -
        # it must always be revalidated, or an installed PWA can keep
        # showing a stale shell (and stale hashed bundle) indefinitely.
        return FileResponse(_STATIC_ROOT / "index.html",
                             headers={"Cache-Control": "no-cache"})
