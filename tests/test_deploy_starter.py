"""The deploy starter kit must work when copied verbatim to .env."""
from pathlib import Path

DEPLOY = Path(__file__).resolve().parent.parent / "deploy"


def _env_values(path):
    """KEY=value pairs the way compose reads them: everything after the
    first '=' up to the end of the line, whitespace trimmed (so a trailing
    '# comment' becomes part of the value)."""
    out = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip()
    return out


def test_env_example_has_no_comment_values():
    values = _env_values(DEPLOY / ".env.example")
    assert values, "expected active settings in .env.example"
    bad = {k: v for k, v in values.items() if "#" in v}
    assert not bad, f"comment text would become the value: {bad}"


def test_env_example_commented_settings_have_no_trailing_comments():
    # Uncommenting a '# KEY=value  # note' line must not smuggle the note in.
    for line in (DEPLOY / ".env.example").read_text().splitlines():
        body = line.lstrip("#").strip()
        key, sep, value = body.partition("=")
        if sep and key.isupper() and key.replace("_", "").isalnum():
            assert "#" not in value, line


def test_proton_compose_requires_bridge_image():
    text = (DEPLOY / "docker-compose.proton.yml").read_text()
    assert "${BRIDGE_IMAGE:?" in text
    assert "protonmail-bridge:local" not in text
