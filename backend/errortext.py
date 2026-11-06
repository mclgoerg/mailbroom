"""English wording of the folder features' error codes (see
`mailops.coded`), for the places that show the backend's own text instead
of the UI's translation - the audit log's CSV export. The UI words the same
codes in the user's language (frontend/src/api.ts ERROR_CODES + locales);
`tests/test_error_codes.py` keeps this table equal to the English locale."""

from __future__ import annotations

from urllib.parse import unquote

# code -> English text, or (text, text for n == 1)
TEXT: dict[str, str | tuple[str, str]] = {
    'login_throttled': (
        'Too many failed attempts. Try again in {n} minutes.',
        'Too many failed attempts. Try again in 1 minute.'),
    'busy_action':
        'Another action is still running - try again when it has finished.',
    'busy_purge':
        'A permanent deletion is already running - try again when it has finished.',
    'busy_scan':
        'A scan is running - try again when it has finished.',
    'busy_rule':
        'Another rule is running - try again when it has finished.',
    'count_required':
        'The folder was not counted yet - reload it and confirm again.',
    'role_missing':
        'No “{folder}” folder found on the server.',
    'inbox_missing':
        'No Inbox found on the server.',
    'junk_needs_trash':
        'No Trash folder found on the server - deleting Junk permanently goes through Trash.',
    'role_unconfirmed':
        'More than one folder could be “{folder}” - choose the right one in Settings first.',
    'junk_is_trash':
        'Junk and Trash are the same folder.',
    'folder_changed':
        'The “{folder}” folder changed on the server - reload the list and try again.',
    'folder_changed_rescan':
        'The “{folder}” folder changed on the server - rescan and try again.',
    'partial_unsafe':
        "This server cannot safely delete only some of a folder's mails, so nothing was deleted.",
    'partial_unsafe_changed':
        "This server cannot safely delete only some of a folder's mails, and the folder changed since it was counted - reload it and try again. Nothing was deleted.",
    'cannot_open':
        'Could not open the “{folder}” folder on the server.',
    'cannot_list':
        "Could not read the folder's mail list.",
    'mailto_unsafe':
        'The unsubscribe address in this mail is not a single plain address '
        '(or its text contains line breaks), so no mail was sent.',
    'move_foreign_deleted':
        'Stopped: another mail program has marked mails in \u201c{folder}\u201d for '
        'deletion, and this server cannot remove just ours, so nothing more '
        'was purged there. Copies of the mails just moved may already be in '
        'the destination folder, and trying again would add another set '
        'while those marks remain. First empty the deleted mails in the other '
        'mail program (expunge), then try again.',
    'unsub_blocked':
        "The unsubscribe link points to a private or internal network address, so it was not called.",
    'unsub_http':
        "The sender's unsubscribe page answered with error {status}.",
    'unsub_tls':
        "The secure connection to the sender's unsubscribe page could not be verified (certificate or TLS problem).",
    'unsub_unreachable':
        "The sender's unsubscribe page could not be reached.",
    'unsub_timeout':
        "The sender's unsubscribe page did not answer in time.",
    'unsub_bad_url':
        "The unsubscribe link in this mail is not a valid web address.",
    'unsub_no_method':
        "This mail has no usable unsubscribe link or address.",
    'unsub_mail_failed':
        "The unsubscribe mail could not be sent - check the account's mail-sending (SMTP) settings.",
    'unsub_pooled':
        "A combined row has no single sender to unsubscribe from - open one of its senders.",
    'unsub_unknown_group':
        "That group no longer exists - rescan and try again.",
    'unsub_failed':
        "Unsubscribing failed unexpectedly. The server log has the details.",
    'cannot_flag':
        'The server did not accept marking the mails for deletion.',
    'cannot_expunge':
        'The server did not remove the marked mails.',
    'cannot_move':
        'The server refused the move.',
    'cannot_remove_copies':
        'The server did not remove the copied mails from Junk.',
    'cannot_read_moved':
        'Could not read the moved mails in Trash.',
    'uv_unreadable':
        'Could not read the state of the “{folder}” folder - nothing is deleted.',
    'no_known_selected':
        'None of the selected mails are in the folder any more - reload it.',
    'unknown_target':
        'The target folder “{folder}” does not exist.',
    'target_is_trash':
        'The target is the Trash folder itself.',
    'nothing_to_undo':
        'There is nothing to undo any more.',
    'deleted_then_failed': (
        '{cause} ({n} mails were permanently deleted before the failure)',
        '{cause} (1 mail was permanently deleted before the failure)'),
    'stranded_then_failed': (
        '{cause} ({n} mails were moved to Trash and not deleted)',
        '{cause} (1 mail was moved to Trash and not deleted)'),
    'moved_then_failed': (
        '{cause} ({n} mails were moved before the failure)',
        '{cause} (1 mail was moved before the failure)'),
    'rule_report_first':
        'Run this rule in report mode first.',
    'rule_folder_changed':
        'The Junk or Trash folder changed since the last report - the rule is back in report mode and nothing was deleted.',
    'rule_purge_grouping':
        'Junk and Trash rules match senders.',
    'rule_purge_keep_latest':
        '“Keep newest N” is not available for Junk and Trash rules.',
    'rule_purge_needs_age':
        'A Junk or Trash rule needs an age (mails older than N days).',
    'rule_purge_filter':
        'This filter is not available for Junk and Trash rules: {names}',
    'rule_purge_filter_domain':
        'This filter is not available for Junk and Trash rules: {names} (it never matches senders - use plain text such as the domain name).',
    'rule_filter_invalid':
        'This filter has parts Inboxrake doesn\'t understand: {names}',
    'rule_filter_invalid_run':
        'The filter has parts Inboxrake doesn\'t understand: {names} - edit the rule. Its execute runs are skipped until then.',
    'rule_filter_too_long':
        'This filter is too long (more than {max} characters).',
    'request_too_large':
        'The request is too large for the server to accept.',
    'block_key_invalid':
        'This sender or domain cannot be blocked: it is not a plain address or domain name.',
    'no_account':
        'No mail account is set up yet - open Settings and fill in the sign-in details first.',
    'cafile_missing':
        'The certificate file {path} does not exist - clear the CA field in Settings (normal providers need none) or mount the file there.',
    'auth_failed':
        'The server refused the sign-in - check the email address and the password (many providers need an app password).',
    'host_unreachable':
        'Could not reach {host} - check the host name, the port and your network.',
    'tls_failed':
        'The secure connection failed - check the security setting, the port and the certificate.',
    'host_not_found':
        '{host} was not found - check the host name for typos.',
    'conn_refused':
        '{host} refused the connection - check the port (IMAP is usually 993 with SSL/TLS or 143 with STARTTLS) and that the server is running.',
    'conn_timeout':
        '{host} did not answer in time - check the host name, the port and your network or firewall.',
    'tls_mismatch':
        '{host} answered, but not with the secure connection you chose - try STARTTLS on port 143 or SSL/TLS on port 993.',
    'not_imap':
        '{host} answered, but not like an IMAP server - check the port (IMAP uses 993 or 143).',
    'cert_failed':
        'The certificate of {host} is not trusted - for a self-signed certificate (e.g. Proton Bridge) enter its CA file in the certificate field of the sign-in settings.',
    'connect_failed':
        'Could not connect to the server - check the settings and try again.',
    'scan_failed':
        'The scan failed unexpectedly - try again; if it keeps failing, check the server log.',
    'not_in_demo':
        'Not available in the demo.',
    'data_not_writable':
        'Inboxrake cannot write to its data folder. On the host, give the user ID 1000 ownership of the folder mounted at /data (chown -R 1000:1000 <folder>) or start the container with --user, then restart it.',
}

ROLE_NAMES = {"trash": "Trash", "junk": "Junk", "archive": "Archive"}


def _params(text: str) -> dict[str, str] | None:
    params: dict[str, str] = {}
    for pair in text.split(","):
        key, eq, value = pair.partition("=")
        if not eq or not key:
            return None
        params[key] = unquote(value, errors="strict")
    return params


def describe(detail: str) -> str:
    """The English text of a coded error detail (nested `cause=` worded
    too); anything else - an unknown code, malformed params, plain text of
    an older entry - is returned as it is."""
    head, colon, rest = (detail or "").partition(":")
    if head not in TEXT:
        return detail
    try:
        params = _params(rest) if colon else {}
    except UnicodeDecodeError:
        return detail
    if params is None:
        return detail
    if "cause" in params:
        params["cause"] = describe(params["cause"])
    if "role" in params:
        params["folder"] = ROLE_NAMES.get(params["role"], params["role"])
    text = TEXT[head]
    if isinstance(text, tuple):
        text = text[1] if params.get("n") == "1" else text[0]
    for key, value in params.items():
        text = text.replace("{" + key + "}", value)
    return text
