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

DEFAULT_CONFIG = {
    "imap": {
        "host": os.environ.get("IMAP_HOST", "127.0.0.1"),
        "port": int(os.environ.get("IMAP_PORT", "1143")),
        "security": os.environ.get("IMAP_SECURITY", "ssl"),  # ssl | starttls
        "smtp_host": os.environ.get("SMTP_HOST", ""),   # "" = the IMAP host
        "smtp_port": int(os.environ.get("SMTP_PORT", "1025")),
        "smtp_security": os.environ.get("SMTP_SECURITY", "auto"),
        "user": os.environ.get("IMAP_USER", ""),
        "password": os.environ.get("IMAP_PASSWORD", ""),
        "cafile": os.environ.get("IMAP_CAFILE", "/certs/bridge-cert.pem"),
        # Which provider preset filled the fields (UI prefill + Proton-only
        # features like Sieve export). Existing configs default to proton.
        "preset": "proton",
    },
    # Multi-account: named copies of the "imap" block. "imap" is always the
    # ACTIVE account so the rest of the code never has to care.
    "profiles": {},
    "active_profile": "default",
    "excluded_folders": DEFAULT_EXCLUDED,
    # Protected senders: addresses ("user@example.com") or domains
    # ("@example.com" / "example.com"). Bulk deletes and selection presets
    # skip them; the AI must never rate their mails delete_safe.
    "protected": [],
    # Category overrides: {name: [keywords]}. A name matching a built-in
    # category replaces its keyword list (empty list disables it); other
    # names become new categories. Applied at scan time.
    "categories": {},
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


def load_config() -> dict:
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))  # deep copy
    try:
        saved = json.loads(CONFIG_PATH.read_text())
        for section in ("imap", "ai"):
            cfg[section].update(saved.get(section) or {})
        if isinstance(saved.get("excluded_folders"), list):
            cfg["excluded_folders"] = saved["excluded_folders"]
        if isinstance(saved.get("protected"), list):
            cfg["protected"] = normalize_protected(saved["protected"])
        if isinstance(saved.get("categories"), dict):
            cfg["categories"] = saved["categories"]
        if isinstance(saved.get("profiles"), dict):
            cfg["profiles"] = saved["profiles"]
        if saved.get("active_profile"):
            cfg["active_profile"] = str(saved["active_profile"])
    except (OSError, json.JSONDecodeError):
        pass
    return cfg


def _write(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, indent=1))
    tmp.chmod(0o600)
    tmp.replace(path)


def update_config(body: dict) -> dict:
    """Apply a partial update from the UI; empty secrets keep old values."""
    with _LOCK:
        cfg = load_config()

        # Profile management: switch/save-as/delete, before field updates.
        if body.get("switch_profile"):
            name = str(body["switch_profile"])
            if name not in cfg["profiles"] and name != cfg["active_profile"]:
                raise ValueError(f"unknown profile {name!r}")
            if name in cfg["profiles"]:
                cfg["profiles"][cfg["active_profile"]] = cfg["imap"]
                cfg["imap"] = cfg["profiles"].pop(name)
                cfg["active_profile"] = name
        if body.get("save_profile_as"):
            name = str(body["save_profile_as"]).strip()
            if name and name != cfg["active_profile"]:
                # Stash the current account, start the new one empty-ish.
                cfg["profiles"][cfg["active_profile"]] = dict(cfg["imap"])
                cfg["imap"] = {**cfg["imap"], "user": "", "password": ""}
                cfg["active_profile"] = name
        if body.get("delete_profile"):
            cfg["profiles"].pop(str(body["delete_profile"]), None)

        imap_in = body.get("imap") or {}
        for key in ("host", "user", "smtp_host", "cafile"):
            if key in imap_in:
                cfg["imap"][key] = str(imap_in[key]).strip()
        for key in ("port", "smtp_port"):
            if key in imap_in:
                try:
                    cfg["imap"][key] = int(
                        imap_in[key] or (1143 if key == "port" else 1025))
                except (TypeError, ValueError):
                    pass
        if imap_in.get("security") in IMAP_SECURITY:
            cfg["imap"]["security"] = imap_in["security"]
        if imap_in.get("smtp_security") in SMTP_SECURITY:
            cfg["imap"]["smtp_security"] = imap_in["smtp_security"]
        if imap_in.get("preset") in PRESETS:
            cfg["imap"]["preset"] = imap_in["preset"]
        if imap_in.get("password"):
            cfg["imap"]["password"] = str(imap_in["password"])
        if isinstance(body.get("excluded_folders"), list):
            cfg["excluded_folders"] = [str(f) for f in body["excluded_folders"]]
        if isinstance(body.get("protected"), list):
            cfg["protected"] = normalize_protected(body["protected"])
        if isinstance(body.get("categories"), dict):
            cfg["categories"] = {
                str(k).strip().lower(): [str(p).strip().lower()
                                         for p in v if str(p).strip()]
                for k, v in body["categories"].items()
                if str(k).strip() and isinstance(v, list)}
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
        "imap": {**cfg["imap"], "password": "",
                 "password_set": bool(cfg["imap"]["password"])},
        "profiles": sorted([cfg["active_profile"], *cfg["profiles"]]),
        "active_profile": cfg["active_profile"],
        "excluded_folders": cfg["excluded_folders"],
        "protected": normalize_protected(cfg.get("protected")),
        "categories": cfg.get("categories") or {},
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
