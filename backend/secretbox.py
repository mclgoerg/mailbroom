"""Opt-in encryption at rest for SECRET config fields.

Only the fields that would let an attacker pivot are encrypted: IMAP
passwords, AI API keys, the OIDC client secret. Everything else (mail
metadata, verdicts, stats) stays plain JSON - the threat model here is
a leaked VOLUME BACKUP, not a compromised host (root on the box can
read process memory either way).

The key comes from the MAILBROOM_SECRET_KEY env var (any string works;
generate one with `openssl rand -base64 32`) and is stretched to a
Fernet key via SHA-256. Values are stored as "enc:v1:<token>"; loading
is transparent. Without a key everything stays plaintext (one startup
warning); pre-existing plaintext values are encrypted on the next save.
If the key is lost, the secrets cannot be recovered - re-enter them.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os

log = logging.getLogger("pmc.secrets")

PREFIX = "enc:v1:"
ENV_VAR = "MAILBROOM_SECRET_KEY"


def _fernet():
    key = os.environ.get(ENV_VAR, "").strip()
    if not key:
        return None
    from cryptography.fernet import Fernet
    return Fernet(base64.urlsafe_b64encode(
        hashlib.sha256(key.encode()).digest()))


def enabled() -> bool:
    return bool(os.environ.get(ENV_VAR, "").strip())


def derive_key(purpose: str) -> bytes | None:
    """A 32-byte key for `purpose`, derived from MAILBROOM_SECRET_KEY (None
    without it). Different purposes get unrelated keys."""
    key = os.environ.get(ENV_VAR, "").strip()
    if not key:
        return None
    import hmac
    return hmac.new(key.encode(), f"mailbroom/{purpose}".encode(),
                    hashlib.sha256).digest()


def seal(value: str) -> str:
    """Encrypt one secret for persistence. Pass-through when no key is
    configured, the value is empty, or it is already sealed."""
    value = value or ""
    f = _fernet()
    if f is None or not value or value.startswith(PREFIX):
        return value
    return PREFIX + f.encrypt(value.encode()).decode()


def unseal(value: str) -> str:
    """Decrypt one persisted secret. Plaintext passes through unchanged.
    A sealed value without the (right) key yields "" - the UI then shows
    the secret as unset and it must be re-entered."""
    value = value or ""
    if not value.startswith(PREFIX):
        return value
    f = _fernet()
    if f is None:
        log.error("found an encrypted secret but %s is not set - "
                  "the secret is unusable until the key returns", ENV_VAR)
        return ""
    from cryptography.fernet import InvalidToken
    try:
        return f.decrypt(value[len(PREFIX):].encode()).decode()
    except (InvalidToken, ValueError):
        log.error("could not decrypt a stored secret - %s does not match "
                  "the key it was encrypted with; re-enter the secret",
                  ENV_VAR)
        return ""
