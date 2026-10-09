"""Optional AI review via the official Anthropic SDK.

Two modes: a coarse per-group triage over a whole grouping, and a
fine-grained pass over one group that marks individual deletable mails.
Provider is either the first-party Anthropic API or Microsoft Foundry.
Only metadata leaves the machine: addresses, names, counts, subject lines.
"""

from __future__ import annotations

import json
import logging
import threading
import time

from . import accounts
from . import config as cfgmod
from . import mailops
from . import pinstore
from . import tenants
from . import verdictstore

log = logging.getLogger("pmc.ai")

AI_BATCH = 80
AI_GROUP_MAX = 400                       # hard cap per fine-grained AI call

AI_SYSTEM = """You help clean up a cluttered personal mailbox. You get a list
of email groups (grouped by {grouping}) with mail counts, total size, unread
counts, date ranges, heuristic tags, and samples (subject lines, or sender
addresses when grouped by subject).
For EACH group decide whether all its mails are safe to bulk-delete:

- delete_safe: marketing, newsletters, social-media notifications, shipping/
  delivery status mails, promotional shop mails, automated notifications with
  no lasting value.
- review: mixed or unclear groups, order confirmations and receipts,
  anything money- or account-related that might be worth keeping (invoices,
  bookings, tickets, contracts, security notices).
- keep: personal correspondence, employers, government, doctors, lawyers,
  banks' document mails, anything that looks important or irreplaceable.

"replied": true means the user has written to this sender before - lean
towards keep. Groups the user NEVER replied to, with mostly unread mail,
lean towards delete_safe (still stay careful with money/account mail).

Be conservative: when unsure, prefer review over delete_safe. Broad groups
(a whole domain, a vague subject) deserve extra caution. Give a reason of at
most 12 words per group. Answer for every group in the input."""

# Appended when the payload contains protected senders. The flag itself is
# metadata; the backend additionally downgrades any delete_safe the model
# returns for protected mail, so this is belt AND suspenders.
AI_PROTECTED_NOTE = """
Groups marked "protected": true contain senders the user explicitly
protects. NEVER rate a protected group delete_safe - use review or keep."""

AI_GROUP_PROTECTED_NOTE = """
Mails marked "protected": true are from senders the user explicitly
protects. NEVER rate a protected mail delete_safe - use review or keep."""

AI_SCHEMA = {
    "type": "object",
    "properties": {
        "verdicts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "key": {"type": "string"},
                    "verdict": {"type": "string",
                                "enum": ["delete_safe", "review", "keep"]},
                    "reason": {"type": "string"},
                },
                "required": ["key", "verdict", "reason"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["verdicts"],
    "additionalProperties": False,
}

AI_GROUP_SYSTEM = """You help clean up one group of mails from a personal
mailbox (all from the same {grouping}: {label!r}). You get every mail's uid,
date, subject, read state and size. Rate EACH mail:

- delete_safe: clearly disposable - marketing, promotions, shipping status,
  social notifications, expired offers, outdated automated notices.
- review: possibly worth keeping - receipts, order confirmations, tickets,
  bookings, account or security notices, anything unclear.
- keep: personal messages, documents, contracts, anything important.

"replied": true on a mail means the user has written to its sender before -
lean towards keep for those; senders the user never replied to lean
towards delete_safe.

Be conservative: when unsure, prefer review. Also return a one-sentence note
summarizing what this group contains."""

AI_GROUP_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "uid": {"type": "integer"},
                    "folder_i": {"type": "integer"},
                    "verdict": {"type": "string",
                                "enum": ["delete_safe", "review", "keep"]},
                },
                "required": ["uid", "folder_i", "verdict"],
                "additionalProperties": False,
            },
        },
        "note": {"type": "string"},
    },
    "required": ["items", "note"],
    "additionalProperties": False,
}


def ai_client(cfg: dict):
    """Anthropic-family client (first-party API or Microsoft Foundry)."""
    import anthropic
    ai = cfg["ai"]
    if ai["provider"] == "foundry":
        endpoint = (ai["foundry_endpoint"] or "").rstrip("/")
        if not endpoint:
            raise RuntimeError("Foundry endpoint not configured")
        return anthropic.AnthropicFoundry(api_key=ai["api_key"],
                                          base_url=endpoint)
    return anthropic.Anthropic(api_key=ai["api_key"])


def _openai_client(cfg: dict):
    """OpenAI, or any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM)."""
    import openai
    ai = cfg["ai"]
    if ai["provider"] == "ollama":
        base = (ai["foundry_endpoint"] or "http://localhost:11434").rstrip("/")
        if not base.endswith("/v1"):
            base += "/v1"
        return openai.OpenAI(base_url=base, api_key=ai["api_key"] or "ollama")
    return openai.OpenAI(api_key=ai["api_key"])


def _ai_call(cfg: dict, model: str, system: str, payload: dict, schema: dict):
    """Run one structured-output call; returns (data, tokens_in, tokens_out)."""
    user = json.dumps(payload, ensure_ascii=False)

    if cfg["ai"]["provider"] in ("openai", "ollama"):
        client = _openai_client(cfg)
        kwargs = dict(
            model=model,
            messages=[{"role": "system", "content": system},
                      {"role": "user", "content": user}],
            response_format={"type": "json_schema", "json_schema": {
                "name": "result", "schema": schema, "strict": True}},
        )
        try:
            response = client.chat.completions.create(**kwargs)
        except Exception:
            # Older OpenAI-compatible servers only know json_object mode.
            kwargs["response_format"] = {"type": "json_object"}
            kwargs["messages"][0]["content"] += (
                "\nAnswer ONLY with JSON matching this schema: "
                + json.dumps(schema))
            response = client.chat.completions.create(**kwargs)
        data = json.loads(response.choices[0].message.content)
        usage = response.usage
        return (data, getattr(usage, "prompt_tokens", 0) or 0,
                getattr(usage, "completion_tokens", 0) or 0)

    client = ai_client(cfg)
    response = client.messages.create(
        model=model,
        max_tokens=16000,
        system=system,
        messages=[{"role": "user", "content": user}],
        output_config={"format": {"type": "json_schema", "schema": schema}},
    )
    if response.stop_reason not in ("end_turn", "stop_sequence"):
        raise RuntimeError(f"unexpected stop_reason {response.stop_reason!r}")
    text = next(b.text for b in response.content if b.type == "text")
    return json.loads(text), response.usage.input_tokens, \
        response.usage.output_tokens


def _run_ai(grouping: str, acc=None, keys: set[str] | None = None,
            rerate: bool = False) -> None:
    acc = acc or accounts.get()
    cfg = cfgmod.load_config()
    # Tenants without their own key run on the admin's shared server key
    # (with the per-tenant budget resolved in effective_ai).
    ai_eff, ai_source = cfgmod.effective_ai(cfg)
    cfg = {**cfg, "ai": ai_eff}
    STATE, STATE_LOCK = acc.state, acc.lock
    try:
        model = cfg["ai"]["model"] or "claude-sonnet-5"

        plist = cfg.get("protected") or []
        with STATE_LOCK:
            paddrs = mailops._protected_addrs(plist, acc)
            prot_keys = {r["key"]
                         for r in STATE["groups"][grouping].values()
                         if mailops._group_protected(r, paddrs, acc)}
            # Cached verdicts (applied at scan time) are not re-billed; a
            # `keys` selection further restricts to just those groups
            # (still skipping ones already rated, same as the unscoped run).
            batch_src = [
                {"key": r["key"], "label": r["label"], "count": r["count"],
                 "total_size_kb": r["size"] // 1024,
                 "unread": r["unread"], "first": r["first"],
                 "last": r["last"], "tags": r["tags"],
                 "samples": r["samples"],
                 **({"replied": True} if r.get("replied") else {}),
                 **({"protected": True} if r["key"] in prot_keys else {})}
                for r in STATE["groups"][grouping].values()
                if (r["ai"] is None or (rerate and keys is not None))
                and (keys is None or r["key"] in keys)]
        system = AI_SYSTEM.format(grouping=grouping) + (
            AI_PROTECTED_NOTE if prot_keys else "")

        if not batch_src:
            with STATE_LOCK:
                STATE["ai"]["status"] = "done"
                STATE["ai"]["progress"] = ""
                STATE["notice"] = {"key": "ai_all_cached", "params": {}}
            return

        usage_in = usage_out = 0
        done = 0
        cancelled = False
        over_budget = False
        budget = float(cfg["ai"].get("budget_usd") or 0)
        pin, pout = cfgmod.effective_prices(cfg["ai"])
        try:
            for start in range(0, len(batch_src), AI_BATCH):
                if mailops.cancel_requested("ai", acc):
                    cancelled = True
                    break
                # Long runs must not blow through the cap mid-way: usage is
                # only persisted at the end, so add this run's own spend.
                if budget and cfgmod.month_cost() \
                        + usage_in / 1e6 * pin \
                        + usage_out / 1e6 * pout >= budget:
                    over_budget = True
                    break
                batch = batch_src[start:start + AI_BATCH]
                t0 = time.time()
                data, tin, tout = _ai_call(
                    cfg, model, system, {"groups": batch}, AI_SCHEMA)
                log.info("group review batch: %d groups, %d/%d tokens, %.1fs "
                         "(%s/%s)", len(batch), tin, tout, time.time() - t0,
                         cfg["ai"]["provider"], model)
                usage_in += tin
                usage_out += tout
                applied: dict[str, dict] = {}
                with STATE_LOCK:
                    recs = STATE["groups"][grouping]
                    for v in data["verdicts"]:
                        rec = recs.get(v["key"]) or recs.get(v["key"].lower())
                        if rec:
                            verdict = v["verdict"]
                            if verdict == "delete_safe" \
                                    and rec["key"] in prot_keys:
                                log.info("downgraded delete_safe -> review "
                                         "for protected group %r", rec["key"])
                                verdict = "review"
                            rec["ai"] = {"verdict": verdict,
                                         "reason": v["reason"][:160]}
                            applied[rec["key"]] = rec["ai"]
                    done += len(batch)
                    STATE["ai"]["progress"] = f"{done}/{len(batch_src)} groups"
                    STATE["groups_rev"] += 1
                verdictstore.save(grouping, applied, acc.name)
        finally:
            # Tokens of completed batches are billed even if a later batch
            # fails - always record them.
            spent = (cfgmod.record_usage(cfg["ai"], usage_in, usage_out)
                     if usage_in or usage_out else None)
        with STATE_LOCK:
            STATE["ai"]["status"] = "done"
            STATE["ai"]["progress"] = ""
            if cancelled:
                STATE["notice"] = {"key": "ai_cancelled", "params": {
                    "done": done, "total": len(batch_src)}}
            elif over_budget:
                STATE["notice"] = {"key": "ai_budget", "params": {
                    "done": done, "total": len(batch_src)}}
            STATE["ai"]["usage"] = {"input_tokens": usage_in,
                                    "output_tokens": usage_out,
                                    "cost": spent["cost"] if spent else 0,
                                    "total_cost": spent["total"]["cost"]
                                    if spent else 0}
    except Exception as exc:
        log.exception("AI review failed")
        with STATE_LOCK:
            STATE["ai"]["status"] = "error"
            STATE["ai"]["error"] = f"{type(exc).__name__}: {exc}"


def start_group_review(grouping: str, acc=None,
                       keys: list[str] | None = None,
                       rerate: bool = False) -> None:
    """Review every unrated group in `grouping`, or (when `keys` is given)
    just those - e.g. the user's current selection instead of the whole
    view. `rerate` (only with `keys`) also sends groups that already have
    a verdict and replaces it: an explicit, billed second opinion."""
    acc = acc or accounts.get()
    cfg = cfgmod.load_config()
    ai_eff, ai_source = cfgmod.effective_ai(cfg)
    if ai_source is None:
        raise ValueError("no API key configured")
    cfgmod.check_budget(ai_eff)
    with acc.lock:
        if acc.state["status"] != "done":
            raise RuntimeError("scan first")
        if acc.state["ai"]["status"] == "running":
            raise RuntimeError("AI already running")
        acc.state["ai"] = {"status": "running", "grouping": grouping,
                           "progress": "starting…", "error": "",
                           "usage": None}
        acc.cancel["ai"] = False
    threading.Thread(target=tenants.call_in,
                     args=(acc.tenant, _run_ai, grouping, acc,
                           set(keys) if keys else None, rerate),
                     daemon=True).start()


def ai_group(grouping: str, key: str, offset: int = 0,
             limit: int = 200, acc=None,
             only: set[tuple[str, int]] | None = None) -> dict:
    """Rate one batch of a group's UNRATED mails (cached verdicts skipped).
    The client calls repeatedly until `remaining` is 0, showing progress.
    `only`, when given, restricts both the unrated pool and `total`/
    `remaining` to those (folder, uid) mails - the detail panel's "rate
    only what I selected" mode instead of the whole group."""
    acc = acc or accounts.get()
    cfg = cfgmod.load_config()
    ai_eff, ai_source = cfgmod.effective_ai(cfg)
    if ai_source is None:
        raise RuntimeError("no API key configured")
    cfg = {**cfg, "ai": ai_eff}
    cfgmod.check_budget(cfg["ai"])
    all_mails = mailops.group_mails(grouping, key, with_msgid=True, acc=acc)
    if not all_mails:
        raise RuntimeError("unknown or empty group")
    if only is not None:
        all_mails = [m for m in all_mails if (m["folder"], m["uid"]) in only]
    label = mailops.group_label(grouping, key, acc)
    unrated = [m for m in all_mails if not m["ai"] and m["msgid"]]
    mails = unrated[:max(1, min(limit, AI_GROUP_MAX))]
    if not mails:
        return {"verdicts": [], "note": "", "reviewed": 0, "remaining": 0,
                "total": len(all_mails),
                "usage": {"input_tokens": 0, "output_tokens": 0, "cost": 0,
                          "total_cost": 0}}

    plist = cfg.get("protected") or []
    prot = {(m["folder"], m["uid"]) for m in mails
            if cfgmod.is_protected(m["addr"], plist)}
    replied_to = mailops.load_replied(acc)
    folders = sorted({m["folder"] for m in mails})
    fidx = {f: i for i, f in enumerate(folders)}
    payload = {"mails": [
        {"uid": m["uid"], "folder_i": fidx[m["folder"]], "date": m["date"],
         "subject": m["subject"], "unread": not m["seen"],
         "size_kb": m["size"] // 1024,
         **({"replied": True} if m["addr"] in replied_to else {}),
         **({"protected": True} if (m["folder"], m["uid"]) in prot else {})}
        for m in mails]}
    model = cfg["ai"]["model"] or "claude-sonnet-5"
    system = AI_GROUP_SYSTEM.format(grouping=grouping, label=label) + (
        AI_GROUP_PROTECTED_NOTE if prot else "")
    t0 = time.time()
    data, tin, tout = _ai_call(cfg, model, system, payload, AI_GROUP_SCHEMA)
    log.info("rated %d mails of %r: %d/%d tokens, %.1fs (%s/%s)",
             len(mails), key, tin, tout, time.time() - t0,
             cfg["ai"]["provider"], model)

    known = {(m["folder"], m["uid"]): m["msgid"] for m in mails}
    pinned = pinstore.load_account(acc.name)
    verdicts_out: list = []
    to_store: dict[str, str] = {}
    for it in data["items"]:
        if it.get("verdict") not in ("delete_safe", "review", "keep"):
            continue
        if not (0 <= it.get("folder_i", -1) < len(folders)):
            continue
        pos = (folders[it["folder_i"]], it["uid"])
        if pos not in known:
            continue
        verdict = it["verdict"]
        if known[pos] in pinned:
            # A pinned mail is never a deletion candidate, whatever the
            # model says - forced AFTER the call, so no pin data has to
            # enter the AI payload.
            verdict = "keep"
        elif verdict == "delete_safe" and pos in prot:
            log.info("downgraded delete_safe -> review for protected mail "
                     "uid %d in %r", pos[1], pos[0])
            verdict = "review"
        verdicts_out.append([pos[0], pos[1], verdict])
        to_store[known[pos]] = verdict
    verdictstore.save_mails(to_store)
    if to_store:
        with acc.lock:
            acc.state["groups_rev"] += 1
    spent = cfgmod.record_usage(cfg["ai"], tin, tout)
    return {"verdicts": verdicts_out, "note": data["note"][:400],
            "reviewed": len(mails),
            "remaining": len(unrated) - len(mails),
            "total": len(all_mails),
            "usage": {"input_tokens": tin, "output_tokens": tout,
                      "cost": spent["cost"],
                      "total_cost": spent["total"]["cost"]}}
