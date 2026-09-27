"""Config and AI usage stats, persisted as JSON under /data.

Env vars are the bootstrap defaults; the UI edits everything at runtime.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

CONFIG_PATH = Path(os.environ.get("CONFIG_PATH", "/data/config.json"))
STATS_PATH = Path(os.environ.get("STATS_PATH", "/data/ai_usage.json"))

# Starred and Labels/* are Proton labels: their messages also live in a real
# folder, so scanning them would double-count (and double-delete).
DEFAULT_EXCLUDED = ["Trash", "Spam", "Sent", "Drafts", "All Mail",
                    "Starred", "Labels", "Labels/*"]

# Env-based bootstrap values — used for the FIRST account only (classic
# single-account Docker setups pass Bridge creds via env).
ENV_IMAP = {
    "host": os.environ.get("IMAP_HOST", "127.0.0.1"),
    "port": int(os.environ.get("IMAP_PORT", "1143")),
    "security": os.environ.get("IMAP_SECURITY", "ssl"),   # ssl | starttls
    "smtp_host": os.environ.get("SMTP_HOST", ""),    # "" = the IMAP host
    "smtp_port": int(os.environ.get("SMTP_PORT", "1025")),
    "smtp_security": os.environ.get("SMTP_SECURITY", "auto"),
    "user": os.environ.get("IMAP_USER", ""),
    "password": os.environ.get("IMAP_PASSWORD", ""),
    "cafile": os.environ.get("IMAP_CAFILE", "/certs/bridge-cert.pem"),
    # Which provider preset filled the fields (UI prefill + Proton-only
    # features like Sieve export). Existing configs default to proton.
    "preset": "proton",
}

# Blank slate for ADDITIONAL accounts — env values (e.g. the Bridge
# password) must never leak into them.
NEUTRAL_IMAP = {
    "host": "", "port": 993, "security": "ssl",
    "smtp_host": "", "smtp_port": 465, "smtp_security": "auto",
    "user": "", "password": "", "cafile": "", "preset": "custom",
}

def _env_auth() -> dict:
    """Auth defaults from env (AUTH_MODE, AUTH_PASSWORD, OIDC_*). The
    password is hashed ONCE at import so verification is stable; a mode
    whose prerequisites are missing falls back to "none"."""
    from . import auth as authmod
    password = os.environ.get("AUTH_PASSWORD", "")
    oidc = {
        "issuer": os.environ.get("OIDC_ISSUER", "").rstrip("/"),
        "client_id": os.environ.get("OIDC_CLIENT_ID", ""),
        "client_secret": os.environ.get("OIDC_CLIENT_SECRET", ""),
        "redirect_base": os.environ.get("OIDC_REDIRECT_BASE", "").rstrip("/"),
        "allowed": [a.strip().lower() for a in
                    os.environ.get("OIDC_ALLOWED", "").split(",")
                    if a.strip()],
    }
    mode = os.environ.get("AUTH_MODE", "none")
    if mode not in authmod.AUTH_MODES             or (mode == "password" and not password)             or (mode == "oidc" and not (oidc["issuer"] and oidc["client_id"]
                                        and oidc["client_secret"])):
        mode = "none"
    return {"mode": mode,
            "password_hash": authmod.hash_password(password)
            if password else "",
            "oidc": oidc}



DEFAULT_CONFIG = {
    # Multi-account: {name: imap-block incl. its own excluded_folders}.
    # The FIRST entry is the default account for API calls without an
    # explicit ?account=.
    "accounts": {"default": {**ENV_IMAP,
                             "excluded_folders": DEFAULT_EXCLUDED}},
    # Protected senders: addresses ("user@example.com") or domains
    # ("@example.com" / "example.com"). Bulk deletes and selection presets
    # skip them; the AI must never rate their mails delete_safe.
    "protected": [],
    # Category overrides: {name: [keywords]}. A name matching a built-in
    # category replaces its keyword list (empty list disables it); other
    # names become new categories. Applied at scan time.
    "categories": {},
    # Native login. "none" (default) trusts the network / reverse proxy;
    # "password" = single shared password (scrypt hash); "oidc" = any
    # OpenID Connect provider (empty "allowed" admits every IdP user).
    # Env bootstrap like everything else; the settings UI overrides.
    "auth": _env_auth(),
    "ai": {
        # anthropic | foundry | openai | ollama (any OpenAI-compatible
        # endpoint works via "ollama" + base URL, e.g. LM Studio, vLLM).
        "provider": "anthropic",
        "api_key": os.environ.get("ANTHROPIC_API_KEY", ""),
        "model": os.environ.get("AI_MODEL", "claude-sonnet-5"),
        "foundry_endpoint": "",           # endpoint / base URL (foundry, ollama)
        "price_in": 0.0,                  # USD per 1M input tokens; 0 = auto
        "price_out": 0.0,                 # USD per 1M output tokens; 0 = auto
        "budget_usd": 0.0,                # monthly AI spend cap; 0 = none
    },
}

AI_PROVIDERS = ("anthropic", "foundry", "openai", "ollama")
IMAP_SECURITY = ("ssl", "starttls")
SMTP_SECURITY = ("auto", "ssl", "starttls")
PRESETS = ("proton", "gmail", "icloud", "fastmail", "gmx", "mailbox",
           "yahoo", "custom")


def normalize_protected(entries) -> list[str]:
    """Lowercased, deduped protected entries; domains keep a leading '@'."""
    out: list[str] = []
    for e in entries or []:
        e = str(e or "").strip().lower()
        if not e:
            continue
        if "@" not in e:            # bare domain -> "@domain"
            e = "@" + e
        if e not in out:
            out.append(e)
    return out


def is_protected(addr: str, protected: list[str]) -> bool:
    """True if `addr` matches a protected entry (exact address, or the
    address's domain for "@domain" entries). Expects a normalized list."""
    addr = (addr or "").strip().lower()
    if not addr or not protected:
        return False
    for e in protected:
        if e.startswith("@"):
            if addr.endswith(e):
                return True
        elif addr == e:
            return True
    return False


def set_protected(entry: str, on: bool) -> list[str]:
    """Add or remove one protected entry; returns the saved list."""
    norm = normalize_protected([entry])
    if not norm:
        raise ValueError("empty protected entry")
    with _LOCK:
        cfg = load_config()
        plist = normalize_protected(cfg.get("protected"))
        if on and norm[0] not in plist:
            plist.append(norm[0])
        elif not on:
            plist = [e for e in plist if e != norm[0]]
        cfg["protected"] = plist
        _write(CONFIG_PATH, cfg)
        return plist


def ai_available(ai_cfg: dict) -> bool:
    """Local models need no API key; everything else does."""
    return bool(ai_cfg.get("api_key")) or ai_cfg.get("provider") == "ollama"

# USD per 1M tokens (input, output). Anthropic first-party rates; Foundry is
# billed via the Azure Marketplace at the same standard API rates. Matched by
# longest model-id prefix; override in settings for custom deployments.
MODEL_PRICES = {
    "claude-sonnet-5": (2.00, 10.00),
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-haiku-4-5": (1.00, 5.00),
    "claude-opus-5": (5.00, 25.00),
    "claude-opus-4": (5.00, 25.00),
    "claude-fable-5": (10.00, 50.00),
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
    "gpt-4.1-nano": (0.10, 0.40),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1": (2.00, 8.00),
    "gpt-5-nano": (0.05, 0.40),
    "gpt-5-mini": (0.25, 2.00),
    "gpt-5": (1.25, 10.00),
}

EMPTY_STATS = {"input_tokens": 0, "output_tokens": 0, "cost": 0.0,
               "runs": 0, "months": {}}

_LOCK = threading.Lock()


def _load_accounts(saved: dict) -> dict[str, dict]:
    """Accounts from a saved config, migrating the old single-account
    format (imap + profiles + active_profile) transparently. The first
    account merges over the env bootstrap values (classic Docker setups);
    additional accounts merge over neutral defaults so env secrets never
    leak into them. Folder exclusions are PER ACCOUNT (providers name
    their folders differently); a legacy top-level excluded_folders list
    fills every account that doesn't have its own yet."""
    if isinstance(saved.get("accounts"), dict) and saved["accounts"]:
        blocks = {str(n): (b if isinstance(b, dict) else {})
                  for n, b in saved["accounts"].items()}
    elif "imap" in saved or "profiles" in saved:
        active = str(saved.get("active_profile") or "default")
        blocks = {active: saved.get("imap") or {}}
        for n, p in (saved.get("profiles") or {}).items():
            if isinstance(p, dict) and str(n) not in blocks:
                blocks[str(n)] = p
    else:
        blocks = {"default": {}}
    legacy_excluded = (saved.get("excluded_folders")
                       if isinstance(saved.get("excluded_folders"), list)
                       else None)
    out: dict[str, dict] = {}
    for i, (name, block) in enumerate(blocks.items()):
        base = ENV_IMAP if i == 0 else NEUTRAL_IMAP
        out[name] = {**base, **block}
        if not isinstance(out[name].get("excluded_folders"), list):
            out[name]["excluded_folders"] = list(
                legacy_excluded if legacy_excluded is not None
                else DEFAULT_EXCLUDED)
    return out


def load_config() -> dict:
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))  # deep copy
    try:
        saved = json.loads(CONFIG_PATH.read_text())
        cfg["accounts"] = _load_accounts(saved)
        cfg["ai"].update(saved.get("ai") or {})
        if isinstance(saved.get("protected"), list):
            cfg["protected"] = normalize_protected(saved["protected"])
        if isinstance(saved.get("categories"), dict):
            cfg["categories"] = saved["categories"]
        auth_saved = saved.get("auth")
        if isinstance(auth_saved, dict):
            cfg["auth"].update({k: v for k, v in auth_saved.items()
                                if k != "oidc"})
            if isinstance(auth_saved.get("oidc"), dict):
                cfg["auth"]["oidc"].update(auth_saved["oidc"])
    except (OSError, json.JSONDecodeError):
        pass
    return cfg


def account_imap(name: str) -> dict:
    """The imap block of one account; raises ValueError for unknown names."""
    accounts = load_config()["accounts"]
    if name not in accounts:
        raise ValueError(f"unknown account {name!r}")
    return accounts[name]


def _write(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, indent=1))
    tmp.chmod(0o600)
    tmp.replace(path)


def _apply_imap(block: dict, imap_in: dict) -> None:
    """Fold a partial imap update into one account's block (in place)."""
    if isinstance(imap_in.get("excluded_folders"), list):
        block["excluded_folders"] = [str(f)
                                     for f in imap_in["excluded_folders"]]
    for key in ("host", "user", "smtp_host", "cafile"):
        if key in imap_in:
            block[key] = str(imap_in[key]).strip()
    for key in ("port", "smtp_port"):
        if key in imap_in:
            try:
                block[key] = int(
                    imap_in[key] or (1143 if key == "port" else 1025))
            except (TypeError, ValueError):
                pass
    if imap_in.get("security") in IMAP_SECURITY:
        block["security"] = imap_in["security"]
    if imap_in.get("smtp_security") in SMTP_SECURITY:
        block["smtp_security"] = imap_in["smtp_security"]
    if imap_in.get("preset") in PRESETS:
        block["preset"] = imap_in["preset"]
    if imap_in.get("password"):
        block["password"] = str(imap_in["password"])


def update_config(body: dict) -> dict:
    """Apply a partial update from the UI; empty secrets keep old values."""
    with _LOCK:
        cfg = load_config()

        # Account management, before field updates.
        if body.get("add_account"):
            name = str(body["add_account"]).strip()[:60]
            if not name:
                raise ValueError("account needs a name")
            if name in cfg["accounts"]:
                raise ValueError(f"account {name!r} already exists")
            cfg["accounts"][name] = dict(NEUTRAL_IMAP)
        if body.get("delete_account"):
            name = str(body["delete_account"])
            if name not in cfg["accounts"]:
                raise ValueError(f"unknown account {name!r}")
            if len(cfg["accounts"]) == 1:
                raise ValueError("cannot delete the last account")
            cfg["accounts"].pop(name)
        if isinstance(body.get("rename_account"), dict):
            old = str(body["rename_account"].get("from") or "")
            new = str(body["rename_account"].get("to") or "").strip()[:60]
            if old not in cfg["accounts"]:
                raise ValueError(f"unknown account {old!r}")
            if not new:
                raise ValueError("account needs a name")
            if new != old and new in cfg["accounts"]:
                raise ValueError(f"account {new!r} already exists")
            # Rebuild in place so the account keeps its position (the
            # FIRST account stays the default one).
            cfg["accounts"] = {(new if n == old else n): b
                               for n, b in cfg["accounts"].items()}

        # Single-account update: {"account": name, "imap": {...}}.
        if isinstance(body.get("imap"), dict):
            target = str(body.get("account") or next(iter(cfg["accounts"])))
            if target not in cfg["accounts"]:
                raise ValueError(f"unknown account {target!r}")
            _apply_imap(cfg["accounts"][target], body["imap"])
        # Bulk shape (config import): {"accounts": {name: {...}}} — creates
        # missing accounts; passwords only change when explicitly provided.
        if isinstance(body.get("accounts"), dict):
            for name, imap_in in body["accounts"].items():
                if not isinstance(imap_in, dict):
                    continue
                name = str(name).strip()[:60]
                if not name:
                    continue
                block = cfg["accounts"].setdefault(name, dict(NEUTRAL_IMAP))
                _apply_imap(block, imap_in)

        # Folder exclusions are per account; top-level stays accepted for
        # old clients/backups and targets body["account"] (default: first).
        if isinstance(body.get("excluded_folders"), list):
            target = str(body.get("account") or next(iter(cfg["accounts"])))
            if target not in cfg["accounts"]:
                raise ValueError(f"unknown account {target!r}")
            cfg["accounts"][target]["excluded_folders"] = [
                str(f) for f in body["excluded_folders"]]
        if isinstance(body.get("protected"), list):
            cfg["protected"] = normalize_protected(body["protected"])
        if isinstance(body.get("categories"), dict):
            cfg["categories"] = {
                str(k).strip().lower(): [str(p).strip().lower()
                                         for p in v if str(p).strip()]
                for k, v in body["categories"].items()
                if str(k).strip() and isinstance(v, list)}
        auth_in = body.get("auth") or {}
        if auth_in:
            from . import auth as authmod
            acfg = cfg["auth"]
            if auth_in.get("password"):
                acfg["password_hash"] = authmod.hash_password(
                    str(auth_in["password"]))
            oidc_in = auth_in.get("oidc") or {}
            for key in ("issuer", "client_id", "redirect_base"):
                if key in oidc_in:
                    acfg["oidc"][key] = str(oidc_in[key]).strip().rstrip("/")
            if oidc_in.get("client_secret"):
                acfg["oidc"]["client_secret"] = str(oidc_in["client_secret"])
            if isinstance(oidc_in.get("allowed"), list):
                acfg["oidc"]["allowed"] = [
                    str(a).strip().lower() for a in oidc_in["allowed"]
                    if str(a).strip()]
            mode = auth_in.get("mode")
            if mode in authmod.AUTH_MODES:
                if mode == "password" and not acfg["password_hash"]:
                    raise ValueError("set a password before enabling "
                                     "password login")
                if mode == "oidc" and not (acfg["oidc"]["issuer"]
                                           and acfg["oidc"]["client_id"]
                                           and acfg["oidc"]["client_secret"]):
                    raise ValueError("OIDC needs issuer, client ID and "
                                     "client secret")
                acfg["mode"] = mode
        ai_in = body.get("ai") or {}
        if ai_in.get("provider") in AI_PROVIDERS:
            cfg["ai"]["provider"] = ai_in["provider"]
        for key in ("model", "foundry_endpoint"):
            if key in ai_in:
                cfg["ai"][key] = str(ai_in[key]).strip()
        for key in ("price_in", "price_out", "budget_usd"):
            if key in ai_in:
                try:
                    cfg["ai"][key] = max(0.0, float(ai_in[key] or 0))
                except (TypeError, ValueError):
                    pass
        if ai_in.get("api_key"):
            cfg["ai"]["api_key"] = str(ai_in["api_key"])
        _write(CONFIG_PATH, cfg)
        return cfg


def masked_config(cfg: dict) -> dict:
    return {
        "accounts": {
            n: {**b, "password": "", "password_set": bool(b["password"])}
            for n, b in cfg["accounts"].items()},
        "default_account": next(iter(cfg["accounts"])),
        "protected": normalize_protected(cfg.get("protected")),
        "categories": cfg.get("categories") or {},
        "auth": {
            "mode": cfg["auth"]["mode"],
            "password_set": bool(cfg["auth"]["password_hash"]),
            "oidc": {"issuer": cfg["auth"]["oidc"]["issuer"],
                     "client_id": cfg["auth"]["oidc"]["client_id"],
                     "client_secret_set":
                         bool(cfg["auth"]["oidc"]["client_secret"]),
                     "redirect_base": cfg["auth"]["oidc"]["redirect_base"],
                     "allowed": cfg["auth"]["oidc"]["allowed"]},
        },
        "ai": {"provider": cfg["ai"]["provider"],
               "model": cfg["ai"]["model"],
               "foundry_endpoint": cfg["ai"]["foundry_endpoint"],
               "price_in": cfg["ai"].get("price_in") or 0,
               "price_out": cfg["ai"].get("price_out") or 0,
               "budget_usd": cfg["ai"].get("budget_usd") or 0,
               "month_cost": month_cost(),
               "prices_effective": effective_prices(cfg["ai"]),
               "api_key": "", "api_key_set": bool(cfg["ai"]["api_key"]),
               "available": ai_available(cfg["ai"])},
        "ai_stats": load_stats(),
    }


def effective_prices(ai_cfg: dict) -> tuple[float, float]:
    pin = float(ai_cfg.get("price_in") or 0)
    pout = float(ai_cfg.get("price_out") or 0)
    if pin and pout:
        return pin, pout
    model = (ai_cfg.get("model") or "").lower()
    for prefix in sorted(MODEL_PRICES, key=len, reverse=True):
        if model.startswith(prefix):
            auto = MODEL_PRICES[prefix]
            return pin or auto[0], pout or auto[1]
    return pin, pout


def load_stats() -> dict:
    try:
        saved = json.loads(STATS_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        saved = {}
    stats = {**EMPTY_STATS, **saved}
    # never hand out the shared EMPTY_STATS["months"] dict for mutation
    stats["months"] = dict(stats.get("months") or {})
    return stats


def reset_stats() -> None:
    with _LOCK:
        _write(STATS_PATH, EMPTY_STATS)


def record_usage(ai_cfg: dict, tokens_in: int, tokens_out: int) -> dict:
    """Add one AI run to the persistent totals; returns {cost, total}."""
    import time
    pin, pout = effective_prices(ai_cfg)
    cost = tokens_in / 1e6 * pin + tokens_out / 1e6 * pout
    month = time.strftime("%Y-%m")
    with _LOCK:
        stats = load_stats()
        stats["input_tokens"] += tokens_in
        stats["output_tokens"] += tokens_out
        stats["cost"] = round(stats["cost"] + cost, 6)
        stats["runs"] += 1
        months = stats.setdefault("months", {})
        months[month] = round(months.get(month, 0) + cost, 6)
        _write(STATS_PATH, stats)
    return {"cost": round(cost, 6), "total": stats}


def month_cost() -> float:
    import time
    return load_stats().get("months", {}).get(time.strftime("%Y-%m"), 0.0)


def check_budget(ai_cfg: dict) -> None:
    """Raise before an AI call when this month's spend has reached the cap.
    Already-started runs still record their usage — bills don't un-happen."""
    budget = float(ai_cfg.get("budget_usd") or 0)
    if budget and month_cost() >= budget:
        raise ValueError(
            f"monthly AI budget reached (${month_cost():.2f} of "
            f"${budget:.2f}) — raise it in settings to continue")
