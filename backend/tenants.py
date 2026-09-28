"""Tenant layer: one isolated workspace per OIDC identity.

A tenant owns a full set of the app's JSON files (config, verdicts,
replied cache, stats, rules, scan snapshots). Auth modes "none" and
"password" always use the single DEFAULT tenant, which maps to the
legacy top-level /data paths - existing single-user deployments keep
working unchanged. In OIDC mode the ADMIN identity also maps to the
DEFAULT tenant (it "claims" the pre-tenancy workspace without any file
moves, so the switch is idempotent and reversible), while every other
allowed identity gets its own directory under /data/tenants/.

The current tenant travels in a contextvar: the request middleware sets
it after resolving the session, and background workers re-enter their
account's tenant via `call_in`. Path helpers in the persistence modules
fall back to the legacy module constants for the DEFAULT tenant, so
env overrides (CONFIG_PATH, …) and tests keep their meaning.
"""

from __future__ import annotations

import contextlib
import contextvars
import hashlib
import os
import re
from pathlib import Path

TENANTS_DIR = Path(os.environ.get("TENANTS_DIR", "/data/tenants"))

DEFAULT_ID = "default"


class Tenant:
    """One workspace. `root` is None for the DEFAULT tenant (legacy
    top-level paths); tenant directories hold the same file names."""

    def __init__(self, id: str, subject: str = "", root: Path | None = None):
        self.id = id
        self.subject = subject
        self.root = root

    @property
    def is_default(self) -> bool:
        return self.root is None

    def file(self, name: str, legacy: Path) -> Path:
        """This tenant's path for one persistence file. The DEFAULT
        tenant uses the (env-overridable) legacy path unchanged."""
        return legacy if self.root is None else self.root / name

    def dir(self, legacy: Path) -> Path:
        """Like file(), for directory-shaped storage (scan snapshots)."""
        return legacy if self.root is None else self.root

    def __repr__(self) -> str:
        return f"Tenant({self.id!r})"


DEFAULT = Tenant(DEFAULT_ID)

_current: contextvars.ContextVar[Tenant] = contextvars.ContextVar(
    "tenant", default=DEFAULT)
_subject: contextvars.ContextVar[str] = contextvars.ContextVar(
    "tenant_subject", default="")


def current() -> Tenant:
    return _current.get()


def current_subject() -> str:
    """The session subject of the current request ("" when anonymous)."""
    return _subject.get()


def activate(tenant: Tenant, subject: str = "") -> None:
    """Bind tenant + subject to the current context (request middleware)."""
    _current.set(tenant)
    _subject.set(subject or tenant.subject)


@contextlib.contextmanager
def use(tenant: Tenant, subject: str = ""):
    """Temporarily enter a tenant (scheduler, lifespan, tests)."""
    t1 = _current.set(tenant)
    t2 = _subject.set(subject or tenant.subject)
    try:
        yield tenant
    finally:
        _current.reset(t1)
        _subject.reset(t2)


def call_in(tenant: Tenant, fn, *args, **kwargs):
    """Run `fn` inside `tenant` - thread targets don't inherit the
    spawning request's contextvars, so workers re-enter explicitly."""
    with use(tenant):
        return fn(*args, **kwargs)


def _slug(subject: str) -> str:
    s = re.sub(r"[^A-Za-z0-9._-]", "_", subject)[:40] or "tenant"
    h = hashlib.sha1(subject.encode()).hexdigest()[:8]
    return f"{s}_{h}"


def for_subject(subject: str) -> Tenant:
    """The tenant of one non-admin OIDC identity."""
    subject = (subject or "").strip().lower()
    return Tenant(_slug(subject), subject, TENANTS_DIR / _slug(subject))


def known() -> list[Tenant]:
    """Every tenant with data on disk: DEFAULT plus one per directory.
    Directory names don't recover the subject - not needed for the
    scheduler / lifespan walks this feeds."""
    out = [DEFAULT]
    try:
        for p in sorted(TENANTS_DIR.iterdir()):
            if p.is_dir():
                out.append(Tenant(p.name, "", p))
    except OSError:
        pass
    return out
