"""English wording of the folder features' error codes (see
`mailops.coded`), for the places that show the backend's own text instead
of the UI's translation - the audit log's CSV export. The UI words the same
codes in the user's language (frontend/src/api.ts ERROR_CODES + locales);
`tests/test_error_codes.py` keeps this table equal to the English locale."""

from __future__ import annotations

from urllib.parse import unquote

# code -> English text, or (text, text for n == 1)
TEXT: dict[str, str | tuple[str, str]] = {
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
