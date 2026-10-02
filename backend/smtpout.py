"""Shared SMTP send path: connect (SSL/STARTTLS/auto) + auth (XOAUTH2 or
password) + send one plain-text message, from one account's own IMAP
config block. Factored out of unsub._send_mailto (the List-Unsubscribe
mailto: case) so it and digest.py (activity digest mail) share exactly
one place for the SSL/STARTTLS/auto + XOAUTH2 handling.
"""

from __future__ import annotations

import smtplib
import ssl

from . import config as cfgmod


def _connect(im: dict) -> smtplib.SMTP:
    ctx = ssl.create_default_context(cafile=im["cafile"] or None)
    host = im.get("smtp_host") or im["host"]     # providers often split them
    port = int(im.get("smtp_port") or 1025)
    security = im.get("smtp_security") or "auto"
    if security == "ssl":
        return smtplib.SMTP_SSL(host, port, timeout=30, context=ctx)
    if security == "starttls":
        smtp = smtplib.SMTP(host, port, timeout=30)
        smtp.starttls(context=ctx)
        return smtp
    try:                                          # auto: SSL, then STARTTLS
        return smtplib.SMTP_SSL(host, port, timeout=30, context=ctx)
    except (ssl.SSLError, OSError):
        smtp = smtplib.SMTP(host, port, timeout=30)
        smtp.starttls(context=ctx)
        return smtp


def send(im: dict, to_addr: str, subject: str, body: str,
        account_name: str | None = None) -> None:
    """Send one plain-text mail from the account's own address. Raises on
    any failure (connect/auth/send) - callers decide how to report it."""
    sender = im["user"]
    msg = (f"From: {sender}\r\nTo: {to_addr}\r\nSubject: {subject}\r\n"
           f"\r\n{body}\r\n")
    smtp = _connect(im)
    try:
        oauth = im.get("oauth")
        if oauth and oauth.get("refresh_token"):
            from . import oauthflow
            fresh = oauthflow.ensure_fresh(oauth)
            if fresh is not oauth and account_name:
                cfgmod.save_oauth(account_name, fresh)
            cb = oauthflow.smtp_auth_callback(sender, fresh["access_token"])
            smtp.auth("XOAUTH2", cb, initial_response_ok=True)
        else:
            smtp.login(im["user"], im["password"])
        smtp.sendmail(sender, [to_addr], msg.encode())
    finally:
        try:
            smtp.quit()
        except Exception:
            pass
