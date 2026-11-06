---
title: "Filter syntax"
description: "The query language of the filter box and of saved rules."
---

# Filter syntax

The filter box above the group list, saved rules and the "describe a
filter" helper all use the same small query language. The browser
(`frontend/src/lib.ts`) and the backend rules engine (`backend/rules.py`)
implement it identically, so a rule matches exactly what you saw in the UI.

A query is a list of words separated by spaces; **all** of them must match
(logical AND). Matching is case-insensitive.

## Free words

A word without a qualifier must appear in the group's key (sender address,
domain or subject), its label, or its sub-label. `shop` finds
`news@shop.example`.

## Qualifiers

| Qualifier | Meaning | Example |
|---|---|---|
| `tag:<name>` | A category tag of the group contains this text (substring, one word). | `tag:newsletter` |
| `ai:safe\|review\|keep` | The AI verdict of the group. | `ai:safe` |
| `age:>N(m\|y)` | The last mail of the group is older than N months or years. | `age:>1y` |
| `unread:>N` | At least N percent of the group's mails are unread (0-100). | `unread:>80` |
| `att:>N(k\|m\|g)` | The group's attachments add up to at least N kilo-, mega- or gigabytes; the unit is optional and a bare number means bytes (a total over the group, not single mails). Needs attachment analysis. | `att:>10m` |
| `is:unsub` | At least one sender has an unsubscribe link. | `is:unsub` |
| `is:unsubscribed` | Every unsubscribable sender is already unsubscribed. | |
| `is:not-unsubscribed` | Some sender could still be unsubscribed. | |
| `is:protected` | The group contains protected senders. | |
| `is:replied` | You have written to the sender before. | |
| `is:noreply-ever` | You never wrote to any of its senders. | |
| `is:new` | A recently first-seen sender (see `NEW_SENDER_WINDOW_DAYS` in [Configuration](configuration.md)). | |
| `is:still-mailing` | Mail kept arriving after a successful unsubscribe. | |
| `has:pinned` | The group contains at least one pinned mail. | |
| `has:tracker` | A checked mail carries a tracking pixel or click tracking (needs the local body index). | |
| `eng:low\|medium\|high` | How much you engage with the sender: scores up to 33 are low, 34-66 medium, 67 and up high. | `eng:low` |
| `from:<address>` | Exactly this sender address (sender grouping only). | `from:news@shop.example` |
| `domain:<domain>` | Exactly this domain (domain grouping). | `domain:shop.example` |

`age:` also accepts the number without `>`; `age:>6m` and `age:6m` mean
the same.

**Typos can widen a filter.** An unknown qualifier name, or a bad value for
`is:`, `has:` or `eng:`, is treated as a free
word and usually matches nothing. But an invalid `age:`, `unread:` or
`att:` value (for example `age:>2w`, `unread:high`, `att:>10mb`) is
silently **ignored** and the rest of the filter still applies - so the
filter matches *more* mail, not less. `tag:newsletter age:>2w` selects
every newsletter group. Check the result list before you act. Saving a **rule**
with such a part is refused with an error that names it, and a rule saved
before that check shows a warning: its execute runs are skipped (report runs
still run) until you edit the filter. Words that contain a colon (such as `re:` or `10:30`) are read as
qualifiers in a rule and refused unless they are valid ones. The AI filter writer validates strictly
and retries when the filter it wrote contains a bad token.

## Combining

```text
tag:newsletter age:>1y unread:>80
```

means: newsletter-tagged groups whose last mail is over a year old and
that you mostly never opened.

## Rules

A saved rule is a filter plus an action and a schedule (manual, daily,
weekly). Rules always start in **report mode** - a run only records what
would happen - and editing a rule's filter, action, target, retention
or account sends it back to report mode (it needs one report run of the
new definition before it acts again). Every run is capped
(`RULE_CAP`, default 500 mails).
Executed trash actions are normal reversible moves.

**Purge rules** are the only irreversible kind: they permanently delete
from Junk or Trash. They are opt-in, need a report run of their current
definition first, skip protected senders and pinned mails, and accept only
a filter over sender, date and read state (plus `has:tracker`) - the qualifiers `tag:`, `ai:`,
`is:`, `has:pinned`, `eng:`, `att:` and `domain:` are refused there.
