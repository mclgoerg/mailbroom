"""Per-account runtime state, strictly separated.

Every connected account gets its own AccountState: scan state, message
index, folder UIDVALIDITYs/roles, replied cache, cancel flags and delete
queue - nothing is ever shared or aggregated across accounts. Instances
are created lazily from the configured account names.
"""

from __future__ import annotations

import threading

from . import config as cfgmod
from . import tenants

GROUPINGS = ("sender", "domain", "subject")


def _initial_state() -> dict:
    return {
        "status": "idle", "progress": "", "error": "", "folders": [],
        "groups": {g: {} for g in GROUPINGS},
        "ai": {"status": "idle", "grouping": "", "progress": "", "error": "",
               "usage": None},
        "delete": {"status": "idle", "progress": "", "error": "", "moved": 0},
        "atts": {"status": "idle", "progress": "", "error": "",
                 "mails": 0, "size": 0},   # attachment analysis (lazy)
        "unsub": {"status": "idle", "progress": "", "error": "", "total": 0,
                  "done": 0, "links": 0, "failed": 0, "skipped": 0},
        "trash_count": None,   # mails currently in Trash (None = unknown)
        "notice": None,        # one-shot info for the UI: {key, params}|None
        "scanned_ts": None,    # when the current groups were scanned
        "groups_rev": 1,       # bumped whenever groups/index change - SSE
                               # clients refetch the (big) group list only
                               # when this moves
        "undo": [],            # summaries of undoable move jobs (newest last)
        "folders_raw": [],     # raw IMAP folder names (targets for move-to)
        "rules": [],           # this account's rules (mirrored for SSE)
        "presets": [],         # this account's saved filter presets (SSE)
    }


class AccountState:
    """All mutable runtime state of one account. `lock` guards `state`,
    `index`, `undo_log` and `delete_pending` (same discipline the old
    module-level STATE_LOCK had)."""

    def __init__(self, name: str, tenant: tenants.Tenant | None = None):
        self.name = name
        # The workspace this account belongs to. Background workers use it
        # to re-enter the right tenant context (threads don't inherit the
        # spawning request's contextvars).
        self.tenant = tenant or tenants.current()
        self.lock = threading.Lock()
        self.state = _initial_state()
        self.index: dict[str, dict] = {}     # "folder\x00uid" -> metadata
        self.folder_uv: dict[str, int] = {}  # folder -> UIDVALIDITY at scan
        self.folder_roles: dict[str, str] = {}   # role -> raw folder name
        self.undo_log: list[dict] = []
        self.replied: set[str] = set()
        self.replied_loaded = False
        self.cancel = {"scan": False, "ai": False, "delete": False,
                       "atts": False, "unsub": False}
        self.delete_pending: list[dict] = []
        # UIDs of the delete job currently being processed (guarded by
        # `lock`) - new jobs dedup against these too, not just the queue.
        self.inflight: dict[str, set[int]] = {}


# Keyed (tenant id, account name) - two tenants may both call an account
# "default" without ever sharing state.
_REGISTRY: dict[tuple[str, str], AccountState] = {}
_REG_LOCK = threading.Lock()


def names() -> list[str]:
    return list(cfgmod.load_config()["accounts"])


def default_name() -> str:
    return names()[0]


def get(name: str | None = None) -> AccountState:
    """The AccountState for `name` in the CURRENT TENANT (default: its
    first configured account). Raises KeyError for unknown names - API
    layers turn that into a 400, so one tenant probing another tenant's
    account names learns nothing."""
    known = names()
    name = name or known[0]
    if name not in known:
        raise KeyError(f"unknown account {name!r}")
    tenant = tenants.current()
    with _REG_LOCK:
        return _REGISTRY.setdefault((tenant.id, name),
                                    AccountState(name, tenant))


def all_instantiated() -> list[AccountState]:
    with _REG_LOCK:
        return list(_REGISTRY.values())


def rename(old: str, new: str) -> None:
    """Carry a renamed account's runtime state over to its new name."""
    tid = tenants.current().id
    with _REG_LOCK:
        acc = _REGISTRY.pop((tid, old), None)
        if acc is not None:
            acc.name = new
            _REGISTRY[(tid, new)] = acc


def drop(name: str) -> None:
    """Forget the runtime state of a deleted account."""
    with _REG_LOCK:
        _REGISTRY.pop((tenants.current().id, name), None)


def reset() -> None:
    """Tests only: forget every account's runtime state."""
    with _REG_LOCK:
        _REGISTRY.clear()
