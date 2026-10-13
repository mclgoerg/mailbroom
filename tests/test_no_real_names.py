"""Privacy guard: no real mailbox data in the repository.

Mailbroom is public and its maintainers read their own mail with it, so the
code, tests, fixtures, demo and docs use invented `.example` data only (see
CONTRIBUTING.md "Privacy"). This test enforces the part a machine can see:

  * e-mail addresses, and
  * host names - in URLs (`://`), markdown links, quoted string literals and
    comments - that are real registrable domains.

Everything else (a company named without its domain, a subject line, a
label) is invisible here; `scripts/prepush_leak_scan.py` covers the
maintainer's own data locally before a push.

Allowed: the RFC 2606 / 6761 names (`.example`, `.invalid`, `.test`,
`localhost`, `example.com/.org/.net`), the freemail and platform lists
IMPORTED from `backend/smartkinds.py` (never copied here), the built-in
keyword-category entries IMPORTED from `mailops.CATEGORY_RULES`, and the
short, reasoned list in `tests/allowed_domains.txt`.

The bare-domain pattern only knows a conservative set of TLDs: `.ai`, `.co`,
`.io`, `.me`, `.in`, `.is`, `.so`, `.sh`, `.py`, `.md`, `.rs` ... collide
with i18n keys, logger names and file names. Hosts inside a URL or an
e-mail address are unambiguous and are checked whatever their TLD.
"""

from __future__ import annotations

import ast
import io
import re
import subprocess
import tokenize
from pathlib import Path
from typing import Iterator, NamedTuple

import pytest

from backend import mailops, smartkinds

ROOT = Path(__file__).resolve().parent.parent
ALLOWED_FILE = Path(__file__).with_name("allowed_domains.txt")

# Conservative: no .ai .co .io .me .in .is .so .sh .py .md .rs .cc ...
TLDS = ("com", "net", "org", "de", "at", "ch", "nl", "fr", "es", "it", "uk",
        "eu", "info", "biz", "us", "ca", "au", "jp", "br", "ru", "cz", "pl",
        "be", "se", "no", "dk", "fi", "pt", "gr", "tr", "ie", "hu", "ro",
        "sk", "nz", "za", "mx")
# RFC 2606 / 6761 reserved names plus the single-label stand-ins.
RESERVED_TLDS = frozenset({"example", "invalid", "test", "localhost"})
RFC2606_HOSTS = ("example.com", "example.org", "example.net")

# Unambiguous contexts (a host after `://`, the part after an `@`) are
# checked for every TLD except these file extensions (`icon@2x.png`).
FILE_EXTENSIONS = frozenset({
    "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "css", "js", "mjs",
    "cjs", "ts", "tsx", "jsx", "json", "md", "py", "sh", "rs", "txt", "html",
    "yml", "yaml", "toml", "lock", "map", "woff", "woff2", "ttf", "pdf",
    "zip", "gz", "tgz", "cfg", "ini", "env"})

HOST = r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+"
EMAIL_RE = re.compile(
    rf"(?<![\w.+%-])[a-z0-9][\w.+%-]*@({HOST})(?![\w-])", re.I)
URL_RE = re.compile(
    r"\b[a-z][a-z0-9+.-]*://(?:[^\s/@\"'`<>]*@)?([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)",
    re.I)
BARE_RE = re.compile(
    rf"(?<![\w@.-])((?:[a-z0-9][a-z0-9-]*\.)+(?:{'|'.join(TLDS)}))(?![\w-]|\.\w)",
    re.I)
IPV4_RE = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")

# String literals and comments of the JS family (single-line quotes, template
# literals, `//` and `/* */`; a `//` right after `:` is a URL, not a comment).
JS_STRING_RE = re.compile(
    r"\"(?:[^\"\\\n]|\\.)*\"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`", re.S)
JS_PLACEHOLDER_RE = re.compile(r"\$\{[^}]*\}")
JS_COMMENT_RE = re.compile(r"(?<![:\w])//[^\n]*|/\*.*?\*/", re.S)

SKIP_NAMES = frozenset({"package-lock.json", "yarn.lock", "pnpm-lock.yaml",
                        "CHANGELOG.md", "allowed_domains.txt"})
JS_SUFFIXES = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")
TEXT_PROSE_SUFFIXES = (".md", ".txt", ".rst")
# Source trees whose strings are only checked where they hold an address or a
# URL: i18n keys and UI text sit next to dotted identifiers there.
MARKER_ONLY = ("frontend/src/locales/",)


class Finding(NamedTuple):
    path: str
    line: int
    kind: str          # "email" | "url" | "domain"
    host: str

    def __str__(self) -> str:
        return f"{self.path}:{self.line}: {self.kind} {self.host}"


# ------------------------------------------------------------- allowlist

def parse_allowlist(text: str) -> tuple[dict[str, str], list[str]]:
    """`host  # reason` per line (blank lines and `#` lines are skipped).
    Returns ({host: reason}, problems); an entry without a reason, a
    malformed or duplicate host is a problem."""
    entries: dict[str, str] = {}
    problems: list[str] = []
    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        host, _, reason = line.partition("#")
        host, reason = host.strip(), reason.strip()
        if not re.fullmatch(HOST, host):
            problems.append(f"line {n}: not a lowercase host name")
        elif not reason:
            problems.append(f"line {n}: entry '{host}' has no reason")
        elif host in entries:
            problems.append(f"line {n}: duplicate entry '{host}'")
        else:
            entries[host] = reason
    return entries, problems


def category_hosts() -> set[str]:
    """Domain-shaped entries of the built-in keyword categories: public
    global brands that predate this guard and come from no mailbox. They are
    allowed as they are (removing one would change tagging for every user)."""
    return {p for _, pats in mailops.CATEGORY_RULES for p in pats
            if re.fullmatch(HOST, p)}


def allowed_hosts(extra: dict[str, str] | None = None) -> frozenset[str]:
    """Hosts the guard accepts, together with everything below them."""
    if extra is None:
        extra = parse_allowlist(ALLOWED_FILE.read_text("utf-8"))[0]
    return frozenset(
        {*RFC2606_HOSTS, *smartkinds.FREEMAIL_DOMAINS,
         *smartkinds.MAIL_PLATFORMS, *category_hosts(), *extra})


def host_allowed(host: str, allowed: frozenset[str]) -> bool:
    host = host.lower().strip(".")
    labels = host.split(".")
    if len(labels) < 2 or labels[-1] in RESERVED_TLDS or IPV4_RE.match(host):
        return True
    # A bare public suffix (`co.uk`) is a fact about domains, not a domain;
    # nothing below it is allowed.
    if host in smartkinds.MULTI_SUFFIXES or smartkinds.is_freemail(host):
        return True
    return any(host == a or host.endswith("." + a) for a in allowed)


# -------------------------------------------------------------- scanning

def _line_of(text: str, index: int, first: int) -> int:
    return first + text.count("\n", 0, index)


def _could_be_real(host: str, allowed: frozenset[str]) -> bool:
    """Host of an address or URL that is neither allowed, nor a file name
    (`icon@2x.png`), nor a throwaway like `a@b.c` (no one-letter TLD)."""
    tld = host.rsplit(".", 1)[-1].lower()
    return (len(tld) >= 2 and tld not in FILE_EXTENSIONS
            and not host_allowed(host, allowed))


def scan_segment(text: str, first_line: int, bare: bool,
                 allowed: frozenset[str], path: str) -> Iterator[Finding]:
    """One piece of text (a string literal, a comment, a whole file)."""
    for m in EMAIL_RE.finditer(text):
        if _could_be_real(m.group(1), allowed):
            yield Finding(path, _line_of(text, m.start(), first_line),
                          "email", m.group(1).lower())
    for m in URL_RE.finditer(text):
        if _could_be_real(m.group(1), allowed):
            yield Finding(path, _line_of(text, m.start(), first_line),
                          "url", m.group(1).lower())
    if bare:
        for m in BARE_RE.finditer(text):
            if not host_allowed(m.group(1), allowed):
                yield Finding(path, _line_of(text, m.start(), first_line),
                              "domain", m.group(1).lower())


def python_segments(text: str) -> Iterator[tuple[str, int]]:
    """Every string constant (docstrings included) and every comment of a
    Python source. An f-string is read as one string with each `{...}` as a
    neutral `x`, so `f"a@shop.acme.{suffix}"` is not mistaken for a host
    ending in a dot."""
    nested: set[int] = set()
    for node in ast.walk(ast.parse(text)):
        if isinstance(node, ast.JoinedStr):
            yield "".join(
                v.value if isinstance(v, ast.Constant) else "x"
                for v in node.values), node.lineno
            nested.update(id(v) for v in node.values)
        elif (isinstance(node, ast.Constant) and isinstance(node.value, str)
                and id(node) not in nested):
            yield node.value, node.lineno
    for tok in tokenize.generate_tokens(io.StringIO(text).readline):
        if tok.type == tokenize.COMMENT:
            yield tok.string, tok.start[0]


def js_segments(text: str) -> Iterator[tuple[str, int]]:
    """Strings (a template literal's `${...}` read as a neutral `x`) and
    comments of a JS / TS source."""
    for rx in (JS_STRING_RE, JS_COMMENT_RE):
        for m in rx.finditer(text):
            yield JS_PLACEHOLDER_RE.sub("x", m.group(0)), _line_of(text, m.start(), 1)


def scan_text(path: str, text: str, allowed: frozenset[str]) -> list[Finding]:
    """Findings of one file; the checks depend on what kind of file it is."""
    suffix = Path(path).suffix.lower()
    marker_only = path.startswith(MARKER_ONLY)
    out: list[Finding] = []
    if suffix == ".py":
        try:
            segments = list(python_segments(text))
        except (SyntaxError, tokenize.TokenError):
            segments = []
            out += scan_segment(text, 1, False, allowed, path)
        for seg, line in segments:
            out += scan_segment(seg, line, True, allowed, path)
    elif suffix in JS_SUFFIXES:
        for seg, line in js_segments(text):
            out += scan_segment(seg, line, not marker_only, allowed, path)
    elif suffix in TEXT_PROSE_SUFFIXES:
        out += scan_segment(text, 1, True, allowed, path)
    else:
        # json / yaml / html / Dockerfile / ...: anything address- or
        # URL-shaped, and bare domains inside quotes.
        out += scan_segment(text, 1, False, allowed, path)
        for m in JS_STRING_RE.finditer(text):
            out += scan_segment(m.group(0), _line_of(text, m.start(), 1),
                                True, allowed, path)
    return sorted(set(out))


def should_scan(path: str) -> bool:
    name = Path(path).name
    return name not in SKIP_NAMES and not name.endswith(".lock")


def scan_files(root: Path, paths: list[str],
               allowed: frozenset[str]) -> list[Finding]:
    out: list[Finding] = []
    for rel in paths:
        if not should_scan(rel):
            continue
        try:
            text = (root / rel).read_text("utf-8")
        except (UnicodeDecodeError, OSError):
            continue                      # binary (images) or unreadable
        out += scan_text(rel, text, allowed)
    return out


SKIP_DIRS = frozenset({".git", "node_modules", "dist", "__pycache__",
                       ".pytest_cache", ".venv", "venv", ".mypy_cache"})


def tracked_files(root: Path) -> list[str]:
    """`git ls-files`; without git (a bare container) every file below
    `root` except the usual build / cache directories."""
    try:
        raw = subprocess.run(["git", "-C", str(root), "ls-files", "-z"],
                             capture_output=True, check=True, timeout=60)
        return sorted(p for p in raw.stdout.decode().split("\0") if p)
    except (OSError, subprocess.SubprocessError):
        return sorted(
            p.relative_to(root).as_posix() for p in root.rglob("*")
            if p.is_file() and not SKIP_DIRS & set(p.relative_to(root).parts))


# ---------------------------------------------------------- the real tree

def test_the_repository_names_no_real_domain_or_address():
    allowed = allowed_hosts()
    found = scan_files(ROOT, tracked_files(ROOT), allowed)
    assert not found, (
        "real-looking addresses / hosts in tracked files - use invented "
        "`.example` data (CONTRIBUTING.md 'Privacy'):\n  "
        + "\n  ".join(map(str, found)))


def test_every_allowlist_entry_has_a_reason():
    entries, problems = parse_allowlist(ALLOWED_FILE.read_text("utf-8"))
    assert not problems, problems
    assert entries, "the allowlist file is empty or unreadable"


# ---------------------------------------------------- the guard itself
# Planted values are assembled at run time so this file does not contain
# them as literals (the guard scans itself).

def dom(*labels: str) -> str:
    return ".".join(labels)


PLANT = dom("acme-planted", "com")


def scan_one(tmp_path, rel: str, content: str) -> list[Finding]:
    target = tmp_path / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, "utf-8")
    return scan_files(tmp_path, [rel], allowed_hosts({}))


@pytest.mark.parametrize("rel,content", [
    ("tests/test_x.py", f'ADDR = "jane@{PLANT}"\n'),
    ("tests/test_x.py", f'URL = "https://www.{PLANT}/path"\n'),
    ("tests/test_x.py", f'SENDER = "{PLANT}"\n'),
    ("tests/test_x.py", f'# see mail.{PLANT} for details\n'),
    ("tests/test_x.py", f'def f():\n    """mail.{PLANT} is it."""\n'),
    ("backend/x.py", f'HOSTS = ["{dom("shop", "co", "uk")}"]\n'),
    ("backend/x.py", f'"""\nText\n\nmail.{dom("shop-planted", "de")} -> x\n"""\n'),
    ("docs/a.md", f"Mail jane@{PLANT} for access\n"),
    ("docs/a.md", f"[link](https://{PLANT}/x) and more\n"),
    ("docs/a.md", f"see {PLANT} for details\n"),
    ("frontend/src/a.test.tsx", f'const m = {{ from: "x@{PLANT}" }};\n'),
    ("frontend/src/a.test.tsx", f"const u = `https://{PLANT}/x`;\n"),
    ("frontend/src/a.test.tsx", f'const s = "{PLANT}";\n'),
    ("frontend/src/locales/en.ts", f'  "k": "ask jane@{PLANT}",\n'),
    ("frontend/src/locales/en.ts", f'  "k": "see https://{PLANT}/p",\n'),
    ("scripts/demo.py", f'N = "bob@{dom("planted", "io")}"\n'),
    ("data.json", f'{{"host": "https://{dom("planted", "io")}/x"}}\n'),
    ("deploy/c.yml", f"  url: https://{PLANT}/hook\n"),
])
def test_guard_is_red_on_planted_leaks(tmp_path, rel, content):
    assert scan_one(tmp_path, rel, content)


def test_a_real_registrable_domain_is_not_an_example(tmp_path):
    real = dom("example", "co", "uk")             # a real domain, not RFC 2606
    assert scan_one(tmp_path, "tests/t.py", f'X = "shop.{real}"\n')


@pytest.mark.parametrize("rel,content", [
    ("tests/t.py", 'KEY = "smart.reason.ai"\nL = logging.getLogger("pmc.ai")\n'),
    ("tests/t.py", 'F = "changelog.md"; G = "tests/test_x.py"; H = "a.json"\n'),
    ("tests/t.py", 'A = "jane@shop.example"\nB = "https://news.example/x"\n'),
    ("tests/t.py", 'A = "x@gmail.com"; B = "web.de"; C = "me@proton.me"\n'),
    ("tests/t.py", f'A = "{dom("mail", "example", "com")}"; B = "localhost:8765"\n'),
    ("tests/t.py", 'A = "http://127.0.0.1:8765/x"; B = "http://localhost/"\n'),
    ("tests/t.py", 'A = "https://stripe.com/x"; B = "noreply@members.ebay.de"\n'),
    ("tests/t.py", 'A = "icon@2x.png"; B = "@pytest.mark.slow"\n'),
    ("docs/a.md", "See `smart.reason.ai`, `pmc.ai`, changelog.md and x.example\n"),
    ("frontend/src/a.test.tsx", 'const k = t("smart.reason.ai"); // pmc.ai\n'),
    ("frontend/src/locales/en.ts", '  "smart.reason.ai": "Filed by AI",\n'
                                   '  "a.b.no": "Only keys here",\n'),
    ("frontend/src/App.tsx", 'const a = ["jane@shop.example", "a.example"];\n'),
    ("CHANGELOG.md", f"* see https://{PLANT}/x and jane@{PLANT}\n"),
    ("frontend/package-lock.json", f'{{"resolved": "https://{PLANT}/x.tgz"}}\n'),
])
def test_guard_is_green_on_look_alikes_and_allowed_names(tmp_path, rel, content):
    assert scan_one(tmp_path, rel, content) == []


def test_python_with_a_syntax_error_still_gets_the_address_and_url_checks(tmp_path):
    bad = f'def f(:\n    x = "jane@{PLANT}"\n'
    assert scan_one(tmp_path, "tests/t.py", bad)


def test_a_finding_names_the_file_and_line_but_each_host_once(tmp_path):
    found = scan_one(tmp_path, "tests/t.py",
                     f'a = 1\nb = "jane@{PLANT}"\n')
    assert [(f.path, f.line, f.kind) for f in found] == [
        ("tests/t.py", 2, "email")]
    assert found[0].host == PLANT


def test_extra_allowlist_entries_are_honoured(tmp_path):
    entries = {dom("docs-host-planted", "com"): "documentation"}
    text = f'U = "https://{dom("docs-host-planted", "com")}/x"\n'
    (tmp_path / "t.py").write_text(text, "utf-8")
    assert scan_files(tmp_path, ["t.py"], allowed_hosts(entries)) == []
    assert scan_files(tmp_path, ["t.py"], allowed_hosts({}))


def test_allowlist_parser_rejects_an_entry_without_a_reason():
    entries, problems = parse_allowlist(
        f"# comment\n\n{dom('a-host', 'com')}   # because\n"
        f"{dom('b-host', 'com')}\n"
        f"{dom('c-host', 'com')}  #   \n"
        f"{dom('a-host', 'com')} # twice\n"
        "Not A Host # reason\n")
    assert list(entries) == [dom("a-host", "com")]
    assert len(problems) == 4
    assert "no reason" in problems[0] and "no reason" in problems[1]
    assert "duplicate" in problems[2] and "host name" in problems[3]


def test_imported_lists_are_allowed_without_being_copied():
    allowed = allowed_hosts({})
    assert smartkinds.FREEMAIL_DOMAINS <= allowed
    assert set(smartkinds.MAIL_PLATFORMS) <= allowed
    assert category_hosts() and category_hosts() <= allowed
    assert host_allowed("outlook.de", allowed)          # brand under any TLD
    assert host_allowed(dom("www", "example", "net"), allowed)
    assert not host_allowed(dom("evil" + "zendesk", "com"), allowed)


def test_without_git_every_file_below_the_root_is_listed(tmp_path, monkeypatch):
    (tmp_path / "a").mkdir()
    (tmp_path / "a" / "x.py").write_text("x = 1\n")
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "node_modules" / "y.js").write_text("y")

    def no_git(*args, **kwargs):
        raise FileNotFoundError("git")
    monkeypatch.setattr(subprocess, "run", no_git)
    assert tracked_files(tmp_path) == ["a/x.py"]
