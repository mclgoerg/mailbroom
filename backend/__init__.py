import os


def adopt_former_env(environ) -> list[str]:
    """Settings under the project's former name keep working: each
    MAILBROOM_X fills in INBOXRAKE_X where that is unset or blank (an empty
    `INBOXRAKE_SECRET_KEY=` copied from the new .env.example must not hide
    the old key). Returns the former names found (main.py logs a rename
    hint for each)."""
    former = sorted(k for k in environ if k.startswith("MAILBROOM_"))
    for old in former:
        new = "INBOXRAKE_" + old[len("MAILBROOM_"):]
        if not environ.get(new, "").strip():
            environ[new] = environ[old]
    return former


# Here, before any module reads the environment (some do at import).
FORMER_ENV = adopt_former_env(os.environ)
