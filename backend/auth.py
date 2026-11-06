"""Native login: password (scrypt, stdlib) and OIDC (authorization code).

Sessions are stateless HMAC-signed cookies; the signing secret lives in
/data (created on first use). No new dependencies - hashing is
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
import math
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from . import demo

log = logging.getLogger("inboxrake.auth")

SESSION_SECRET_PATH = Path(
    os.environ.get("SESSION_SECRET_PATH", "/data/session_secret"))
SESSION_MAX_AGE = 30 * 86400          # seconds
STATE_MAX_AGE = 600                   # OIDC roundtrip window
AUTH_MODES = ("none", "password", "oidc")

_secret_cache: bytes | None = None


def _secret() -> bytes:
    global _secret_cache
    if _secret_cache is not None:
        return _secret_cache
    from . import secretbox
    try:
        raw = SESSION_SECRET_PATH.read_bytes()
    except OSError:
        raw = None
    if raw is not None:
        if raw.startswith(secretbox.PREFIX.encode()):
            # Sealed with INBOXRAKE_SECRET_KEY. A missing/changed key
            # yields "" -> fall through and generate a fresh secret
            # (all sessions drop; users just sign in again).
            opened = secretbox.unseal(raw.decode())
            if opened:
                _secret_cache = base64.b64decode(opened)
                return _secret_cache
        else:
            _secret_cache = raw
            if secretbox.enabled():      # legacy plaintext: seal it now
                _persist_secret(_secret_cache)
            return _secret_cache
    _secret_cache = secrets.token_bytes(32)
    _persist_secret(_secret_cache)
    return _secret_cache


def _persist_secret(secret: bytes) -> None:
    """Store the session signing secret, sealed when INBOXRAKE_SECRET_KEY
    is set - a volume backup must not allow forging session cookies."""
    from . import secretbox
    data = secretbox.seal(
        base64.b64encode(secret).decode()).encode() \
        if secretbox.enabled() else secret
    try:
        SESSION_SECRET_PATH.parent.mkdir(parents=True, exist_ok=True)
        SESSION_SECRET_PATH.write_bytes(data)
        SESSION_SECRET_PATH.chmod(0o600)
    except OSError:
        log.exception("could not persist session secret - sessions "
                      "will not survive restarts")


# ------------------------------------------------------------ passwords

def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
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


# A session token is `exp.sub.epoch.sig`. The epoch is a server-side random
# id kept next to the signing secret; renewing it (password / mode /
# allow-list / admin change, "sign out all") invalidates every token at
# once. Logout stays stateless (it only clears the cookie). The old format
# `exp.sub.sig` has three parts: a new image refuses it (one re-login) and
# an older image refuses the new four-part token (its unpack raises).

_epoch_mem: dict[Path, str] = {}


def _epoch_path() -> Path:
    return SESSION_SECRET_PATH.with_name("session_epoch")


def _new_epoch() -> str:
    return secrets.token_hex(8)


_EPOCH_RE = re.compile(r"[0-9a-f]{16}\Z")


def current_epoch() -> str:
    path = _epoch_path()
    try:
        value = path.read_text().strip()
    except OSError:                        # missing (or never writable)
        return _epoch_mem[path] if path in _epoch_mem else renew_epoch()
    except ValueError:                     # not text: garbage
        return renew_epoch()
    return value if _EPOCH_RE.match(value) else renew_epoch()


def renew_epoch() -> str:
    """Invalidate every session issued so far."""
    path = _epoch_path()
    value = _new_epoch()
    _epoch_mem[path] = value
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)
        path.chmod(0o600)
    except OSError:
        log.exception("could not persist the session epoch - sign-out "
                      "of all sessions will not survive a restart")
    return value


def sync_epoch(fingerprint: str) -> bool:
    """Renew the epoch when the effective login settings differ from the
    ones the stored fingerprint was taken from (a password rotated in the
    environment, a changed allow-list, ...). The first call only records
    the fingerprint. True when the epoch was renewed."""
    path = _epoch_path().with_name("session_auth_fp")
    try:
        stored = path.read_text().strip()
    except (OSError, ValueError):
        stored = ""
    if stored == fingerprint:
        return False
    renewed = bool(stored)
    if renewed:
        renew_epoch()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(fingerprint)
        path.chmod(0o600)
    except OSError:
        log.exception("could not persist the login fingerprint")
    return renewed


def keyed_digest(data: bytes) -> str:
    """HMAC of `data` under the session secret (domain-separated)."""
    return hmac.new(_secret(), b"login-fp:" + data, hashlib.sha256).hexdigest()


def make_session(sub: str, now: float | None = None,
                 epoch: str | None = None) -> str:
    exp = int((now or time.time()) + SESSION_MAX_AGE)
    sub64 = base64.urlsafe_b64encode(sub.encode()).decode().rstrip("=")
    body = f"{exp}.{sub64}.{epoch or current_epoch()}"
    return f"{body}.{_sign(body.encode())}"


def verify_session(token: str, now: float | None = None) -> str | None:
    """The session's subject, or None for missing/expired/tampered/
    issued under an older epoch."""
    try:
        exp_s, sub64, epoch, sig = token.split(".")
        body = f"{exp_s}.{sub64}.{epoch}"
        if not hmac.compare_digest(sig, _sign(body.encode())):
            return None
        if not hmac.compare_digest(epoch, current_epoch()):
            return None
        if int(exp_s) < (now or time.time()):
            return None
        pad = "=" * (-len(sub64) % 4)
        return base64.urlsafe_b64decode(sub64 + pad).decode()
    except (ValueError, TypeError):
        return None


class LoginThrottle:
    """Failed password logins per peer address: after `limit` failures
    within `window` seconds the peer is refused until the oldest one ages
    out; a success clears the peer. In memory only (a restart forgives)."""

    def __init__(self, limit: int = 5, window: float = 15 * 60,
                 clock=time.time):
        self.limit, self.window, self.clock = limit, window, clock
        self._fails: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def _recent(self, peer: str) -> list[float]:
        cutoff = self.clock() - self.window
        recent = [t for t in self._fails.get(peer, []) if t > cutoff]
        if recent:
            self._fails[peer] = recent
        else:
            self._fails.pop(peer, None)
        return recent

    def retry_after(self, peer: str) -> int:
        """Seconds until `peer` may try again; 0 when it may now."""
        with self._lock:
            recent = self._recent(peer)
            if len(recent) < self.limit:
                return 0
            return max(1, math.ceil(recent[0] + self.window - self.clock()))

    def failed(self, peer: str) -> None:
        with self._lock:
            if len(self._fails) > 1000:            # bound the table
                for other in list(self._fails):
                    self._recent(other)
            self._recent(peer)
            self._fails.setdefault(peer, []).append(self.clock())

    def succeeded(self, peer: str) -> None:
        with self._lock:
            self._fails.pop(peer, None)


login_throttle = LoginThrottle()


def make_state(now: float | None = None) -> str:
    """Signed CSRF state for the OIDC roundtrip (stateless)."""
    body = f"{int(now or time.time())}.{secrets.token_hex(8)}"
    return f"{body}.{_sign(('state:' + body).encode())}"


# PKCE (RFC 7636, S256): providers like Pocket ID require it even for
# confidential clients. The verifier crosses the roundtrip in an HttpOnly
# Lax cookie (sent on the IdP's top-level redirect back), never in a URL.

def make_verifier() -> str:
    return secrets.token_urlsafe(48)              # 64 chars, in [43, 128]


def code_challenge(verifier: str) -> str:
    return base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


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
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return json.loads(res.read())
    except urllib.error.URLError as exc:
        if demo.denied(exc):
            raise demo.refusal() from exc
        raise


def discovery(issuer: str) -> dict:
    issuer = issuer.rstrip("/")
    if issuer not in _discovery_cache:
        _discovery_cache[issuer] = _http_json(
            issuer + "/.well-known/openid-configuration")
    return _discovery_cache[issuer]


def auth_url(oidc_cfg: dict, redirect_uri: str, state: str,
             verifier: str = "") -> str:
    disc = discovery(oidc_cfg["issuer"])
    params = {
        "response_type": "code",
        "client_id": oidc_cfg["client_id"],
        "redirect_uri": redirect_uri,
        "scope": "openid email profile",
        "state": state,
    }
    if verifier:
        params["code_challenge"] = code_challenge(verifier)
        params["code_challenge_method"] = "S256"
    return disc["authorization_endpoint"] + "?" + urllib.parse.urlencode(
        params)


def exchange_code(oidc_cfg: dict, redirect_uri: str, code: str,
                  verifier: str = "") -> dict:
    """Code -> tokens -> userinfo claims (validated by the userinfo call
    itself: the IdP only answers for access tokens it just issued)."""
    disc = discovery(oidc_cfg["issuer"])
    form = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": oidc_cfg["client_id"],
        "client_secret": oidc_cfg["client_secret"],
    }
    if verifier:
        form["code_verifier"] = verifier
    tokens = _http_json(
        disc["token_endpoint"],
        data=urllib.parse.urlencode(form).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    return _http_json(
        disc["userinfo_endpoint"],
        headers={"Authorization": f"Bearer {tokens['access_token']}"})


def email_unverified(claims: dict) -> bool:
    """True when the IdP says the email is NOT verified (bool False or the
    string "false"). A missing claim counts as verified: some IdPs omit it."""
    v = claims.get("email_verified")
    return v is False or (isinstance(v, str) and v.strip().lower() == "false")


def allowed_subject(claims: dict, allowed: list[str]) -> str | None:
    """The session subject if the claims pass the allow-list (an empty
    list admits ANY user the IdP authenticates). An email the IdP marks
    as unverified is refused: anyone could register it there."""
    if email_unverified(claims):
        return None
    email = str(claims.get("email") or "").strip().lower()
    sub = str(claims.get("sub") or "")
    if not (email or sub):
        return None
    if allowed:
        entries = {str(a).strip().lower() for a in allowed if str(a).strip()}
        if email not in entries and sub.lower() not in entries:
            return None
    return email or sub
