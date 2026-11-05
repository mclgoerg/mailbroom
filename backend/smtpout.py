"""Shared SMTP send path: connect (SSL/STARTTLS/auto) + auth (XOAUTH2 or
password) + send one plain-text message, from one account's own IMAP
config block. Factored out of unsub._send_mailto (the List-Unsubscribe
mailto: case) so it and digest.py (activity digest mail) share exactly
one place for the SSL/STARTTLS/auto + XOAUTH2 handling.
"""

from __future__ import annotations

import re
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from . import config as cfgmod

# One plain address: no whitespace, quotes, brackets, list separators or
# second "@" - whatever a mailto: path decodes to must not become several
# recipients or a display-name construct.
_ONE_ADDRESS = re.compile(r"[^\s,;:<>()\[\]\"'\\@]+@[^\s,;:<>()\[\]\"'\\@]+")


def _has_control(text: str, allow_newlines: bool = False) -> bool:
    return any(ord(c) < 32 or ord(c) == 127 or 0x80 <= ord(c) < 0xA0
               or c in "\u2028\u2029"
               for c in text
               if not (allow_newlines and c in "\r\n"))


def check_plain_mail(to_addr: str, subject: str, text_body: str) -> None:
    """Refuse a message whose recipient is not exactly one address or whose
    subject / body carry CR, LF or other control characters that could add
    headers or recipients (the values come from a mail's List-Unsubscribe
    header, i.e. from a third party). The body may hold plain newlines: it
    sits after the blank line, never in a header."""
    from . import mailops
    if (not _ONE_ADDRESS.fullmatch(to_addr or "")
            or _has_control(to_addr) or _has_control(subject)
            or _has_control(text_body, allow_newlines=True)):
        raise ValueError(mailops.coded(mailops.MAILTO_UNSAFE))


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


def send(im: dict, to_addr: str, subject: str, text_body: str,
        html_body: str | None = None,
        account_name: str | None = None) -> None:
    """Send one mail from the account's own address: plain text only, or
    (when `html_body` is given) a multipart/alternative with both parts -
    no external assets either way (images/fonts/tracking pixels would
    leak to a third party on open). Raises on any failure (connect/auth/
    send) - callers decide how to report it."""
    sender = im["user"]
    if html_body is None:
        # the hand-built message below puts to/subject into raw header
        # lines; its only caller passes third-party (List-Unsubscribe) text
        check_plain_mail(to_addr, subject, text_body)
    if html_body is not None:
        msg = MIMEMultipart("alternative")
        msg["From"] = sender
        msg["To"] = to_addr
        msg["Subject"] = subject
        msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))
        raw = msg.as_bytes()
    else:
        raw = (f"From: {sender}\r\nTo: {to_addr}\r\nSubject: {subject}\r\n"
               f"\r\n{text_body}\r\n").encode()
    smtp = _connect(im)
    try:
        if cfgmod.auth_method(im) == "oauth":
            oauth = im.get("oauth") or {}
            if not oauth.get("refresh_token"):
                raise RuntimeError(cfgmod.OAUTH_NOT_CONNECTED)
            from . import oauthflow
            fresh = oauthflow.ensure_fresh(oauth)
            if fresh is not oauth and account_name:
                cfgmod.save_oauth(account_name, fresh)
            cb = oauthflow.smtp_auth_callback(sender, fresh["access_token"])
            smtp.auth("XOAUTH2", cb, initial_response_ok=True)
        else:
            smtp.login(im["user"], im["password"])
        smtp.sendmail(sender, [to_addr], raw)
    finally:
        try:
            smtp.quit()
        except Exception:
            pass
