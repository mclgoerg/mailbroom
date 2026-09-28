"""OAuth2 for IMAP XOAUTH2 (Google, Microsoft): authorization-code + PKCE,
and Microsoft's device-code flow.

Gmail's restricted https://mail.google.com/ scope requires Google
verification for any client used by more than a handful of testers, so
there is no universal "Sign in with Google" button - every self-hoster
registers their own OAuth client (docs/install.md walks through it).
Microsoft is the exception: a public client (no secret, no redirect URI)
can use the device-code flow, so the maintainer registers ONE Entra app
and ships its ID as MAILBROOM_MS_CLIENT_ID; without that env var,
Microsoft falls back to the same bring-your-own auth-code flow as Google.
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request

log = logging.getLogger("pmc.oauth")

PROVIDERS = ("google", "microsoft")

GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_SCOPE = "https://mail.google.com/"

MS_TENANT = os.environ.get("MAILBROOM_MS_TENANT", "consumers")
MS_AUTH_ENDPOINT = (
    f"https://login.microsoftonline.com/{MS_TENANT}/oauth2/v2.0/authorize")
MS_TOKEN_ENDPOINT = (
    f"https://login.microsoftonline.com/{MS_TENANT}/oauth2/v2.0/token")
MS_DEVICE_ENDPOINT = (
    f"https://login.microsoftonline.com/{MS_TENANT}/oauth2/v2.0/devicecode")
MS_SCOPE = "offline_access https://outlook.office.com/IMAP.AccessAsUser.All"

MS_SHARED_CLIENT_ID = os.environ.get("MAILBROOM_MS_CLIENT_ID", "")


def has_shared_microsoft_client() -> bool:
    return bool(MS_SHARED_CLIENT_ID)


def _http_json(url: str, data: bytes | None = None,
              headers: dict | None = None) -> dict:
    req = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        try:
            return json.loads(body)   # OAuth error responses are JSON too
        except json.JSONDecodeError:
            raise RuntimeError(f"oauth request failed: {exc} {body}")


def _tokens_to_block(tokens: dict) -> dict:
    if "error" in tokens:
        raise RuntimeError(
            f"oauth token error: {tokens.get('error')} "
            f"{tokens.get('error_description', '')}")
    out = {
        "access_token": tokens["access_token"],
        "expires_at": time.time() + float(tokens.get("expires_in", 3600)),
    }
    if tokens.get("refresh_token"):
        out["refresh_token"] = tokens["refresh_token"]
    return out


# ------------------------------------------------------- auth-code + PKCE

def auth_url(provider: str, client_id: str, redirect_uri: str, state: str,
            verifier: str) -> str:
    from . import auth as authmod
    if provider == "google":
        endpoint, scope = GOOGLE_AUTH_ENDPOINT, GOOGLE_SCOPE
    elif provider == "microsoft":
        endpoint, scope = MS_AUTH_ENDPOINT, MS_SCOPE
    else:
        raise ValueError(f"unknown provider {provider!r}")
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": scope,
        "state": state,
        "code_challenge": authmod.code_challenge(verifier),
        "code_challenge_method": "S256",
    }
    if provider == "google":
        # Offline + forced consent, else Google only returns a refresh
        # token on the very first authorization ever granted.
        params["access_type"] = "offline"
        params["prompt"] = "consent"
    return endpoint + "?" + urllib.parse.urlencode(params)


def exchange_code(provider: str, client_id: str, client_secret: str,
                  redirect_uri: str, code: str, verifier: str) -> dict:
    """-> {"access_token", "refresh_token", "expires_at"}"""
    endpoint = (GOOGLE_TOKEN_ENDPOINT if provider == "google"
                else MS_TOKEN_ENDPOINT)
    form = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
        "code_verifier": verifier,
    }
    if client_secret:
        form["client_secret"] = client_secret
    tokens = _http_json(
        endpoint, data=urllib.parse.urlencode(form).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    block = _tokens_to_block(tokens)
    if "refresh_token" not in block:
        raise RuntimeError(
            "the provider did not return a refresh token - for Google, "
            "revoke prior access at myaccount.google.com/permissions and "
            "reconnect")
    return block


def refresh(provider: str, client_id: str, client_secret: str,
           refresh_token: str) -> dict:
    endpoint = (GOOGLE_TOKEN_ENDPOINT if provider == "google"
                else MS_TOKEN_ENDPOINT)
    form = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
    }
    if client_secret:
        form["client_secret"] = client_secret
    tokens = _http_json(
        endpoint, data=urllib.parse.urlencode(form).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    block = _tokens_to_block(tokens)
    # Providers usually omit refresh_token on a refresh call - the old one
    # stays valid.
    block.setdefault("refresh_token", refresh_token)
    return block


def ensure_fresh(oauth: dict) -> dict:
    """The (possibly unchanged) oauth block with a valid access token.
    Callers persist the result when it differs from the input."""
    if float(oauth.get("expires_at") or 0) - 60 > time.time():
        return oauth
    fresh = refresh(oauth["provider"], oauth.get("client_id", ""),
                    oauth.get("client_secret", ""), oauth["refresh_token"])
    return {**oauth, **fresh}


def xoauth2_string(user: str, access_token: str) -> bytes:
    return f"user={user}\x01auth=Bearer {access_token}\x01\x01".encode()


# ------------------------------------------------------------ device code

def device_start() -> dict:
    """Microsoft only, with the shared public client. -> {device_code,
    user_code, verification_uri, expires_in, interval}"""
    if not MS_SHARED_CLIENT_ID:
        raise RuntimeError("no shared Microsoft client is configured on "
                           "this server")
    form = {"client_id": MS_SHARED_CLIENT_ID, "scope": MS_SCOPE}
    return _http_json(
        MS_DEVICE_ENDPOINT, data=urllib.parse.urlencode(form).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"})


def device_poll(device_code: str) -> dict:
    """-> {"status": "pending"|"complete"|"error", ...token fields}.
    Google disallows the restricted Gmail scope in the device flow, so
    this path is Microsoft-only."""
    form = {
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        "device_code": device_code,
        "client_id": MS_SHARED_CLIENT_ID,
    }
    tokens = _http_json(
        MS_TOKEN_ENDPOINT, data=urllib.parse.urlencode(form).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    error = tokens.get("error")
    if error in ("authorization_pending", "slow_down"):
        return {"status": "pending"}
    if error:
        return {"status": "error", "error": error}
    block = _tokens_to_block(tokens)
    block["status"] = "complete"
    block["provider"] = "microsoft"
    block["client_id"] = MS_SHARED_CLIENT_ID
    return block
