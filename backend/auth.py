"""Native login: password (scrypt, stdlib) and OIDC (authorization code).

Sessions are stateless HMAC-signed cookies; the signing secret lives in
/data (created on first use). No new dependencies — hashing is
hashlib.scrypt, OIDC talks plain HTTPS via urllib. This module is pure
mechanics: which mode is active and the stored hash/secrets live in the
config ("auth" section); enforcement happens in main.py's middleware.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
import urllib.parse
import urllib.request
from pathlib import Path

log = logging.getLogger("pmc.auth")

SESSION_SECRET_PATH = Path(
    os.environ.get("SESSION_SECRET_PATH", "/data/session_secret"))
SESSION_MAX_AGE = 30 * 86400          # seconds
STATE_MAX_AGE = 600                   # OIDC roundtrip window
AUTH_MODES = ("none", "password", "oidc")

_secret_cache: bytes | None = None


def _secret() -> bytes:
    global _secret_cache
    if _secret_cache is None:
        try:
            _secret_cache = SESSION_SECRET_PATH.read_bytes()
        except OSError:
            _secret_cache = secrets.token_bytes(32)
            try:
                SESSION_SECRET_PATH.parent.mkdir(parents=True, exist_ok=True)
                SESSION_SECRET_PATH.write_bytes(_secret_cache)
                SESSION_SECRET_PATH.chmod(0o600)
            except OSError:
                log.exception("could not persist session secret — sessions "
                              "will not survive restarts")
    return _secret_cache


# ------------------------------------------------------------ passwords

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt,
                        n=2 ** 14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, salt_hex, dk_hex = stored.split("$")
        if algo != "scrypt":
            return False
        dk = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex),
                            n=2 ** 14, r=8, p=1, dklen=32)
        return hmac.compare_digest(dk.hex(), dk_hex)
    except (ValueError, TypeError):
        return False


# ------------------------------------------------------------- sessions

def _sign(msg: bytes) -> str:
    return hmac.new(_secret(), msg, hashlib.sha256).hexdigest()


def make_session(sub: str, now: float | None = None) -> str:
    exp = int((now or time.time()) + SESSION_MAX_AGE)
    sub64 = base64.urlsafe_b64encode(sub.encode()).decode().rstrip("=")
    body = f"{exp}.{sub64}"
    return f"{body}.{_sign(body.encode())}"


def verify_session(token: str, now: float | None = None) -> str | None:
    """The session's subject, or None for missing/expired/tampered."""
    try:
        exp_s, sub64, sig = token.split(".")
        body = f"{exp_s}.{sub64}"
        if not hmac.compare_digest(sig, _sign(body.encode())):
            return None
        if int(exp_s) < (now or time.time()):
            return None
        pad = "=" * (-len(sub64) % 4)
        return base64.urlsafe_b64decode(sub64 + pad).decode()
    except (ValueError, TypeError):
        return None


def make_state(now: float | None = None) -> str:
    """Signed CSRF state for the OIDC roundtrip (stateless)."""
    body = f"{int(now or time.time())}.{secrets.token_hex(8)}"
    return f"{body}.{_sign(('state:' + body).encode())}"


def verify_state(state: str, now: float | None = None) -> bool:
    try:
        ts_s, nonce, sig = state.split(".")
        body = f"{ts_s}.{nonce}"
        if not hmac.compare_digest(sig, _sign(("state:" + body).encode())):
            return False
        return (now or time.time()) - int(ts_s) <= STATE_MAX_AGE
    except (ValueError, TypeError):
        return False


# ----------------------------------------------------------------- OIDC

_discovery_cache: dict[str, dict] = {}


def _http_json(url: str, data: bytes | None = None,
               headers: dict | None = None) -> dict:
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.loads(res.read())


def discovery(issuer: str) -> dict:
    issuer = issuer.rstrip("/")
    if issuer not in _discovery_cache:
        _discovery_cache[issuer] = _http_json(
            issuer + "/.well-known/openid-configuration")
    return _discovery_cache[issuer]


def auth_url(oidc_cfg: dict, redirect_uri: str, state: str) -> str:
    disc = discovery(oidc_cfg["issuer"])
    return disc["authorization_endpoint"] + "?" + urllib.parse.urlencode({
        "response_type": "code",
        "client_id": oidc_cfg["client_id"],
        "redirect_uri": redirect_uri,
        "scope": "openid email profile",
        "state": state,
    })


def exchange_code(oidc_cfg: dict, redirect_uri: str, code: str) -> dict:
    """Code -> tokens -> userinfo claims (validated by the userinfo call
    itself: the IdP only answers for access tokens it just issued)."""
    disc = discovery(oidc_cfg["issuer"])
    tokens = _http_json(
        disc["token_endpoint"],
        data=urllib.parse.urlencode({
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": oidc_cfg["client_id"],
            "client_secret": oidc_cfg["client_secret"],
        }).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    return _http_json(
        disc["userinfo_endpoint"],
        headers={"Authorization": f"Bearer {tokens['access_token']}"})


def allowed_subject(claims: dict, allowed: list[str]) -> str | None:
    """The session subject if the claims pass the allow-list (an empty
    list admits ANY user the IdP authenticates)."""
    email = str(claims.get("email") or "").strip().lower()
    sub = str(claims.get("sub") or "")
    if not (email or sub):
        return None
    if allowed:
        entries = {str(a).strip().lower() for a in allowed if str(a).strip()}
        if email not in entries and sub.lower() not in entries:
            return None
    return email or sub
