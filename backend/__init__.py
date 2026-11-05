import os


def adopt_former_env(environ) -> list[str]:
    """Settings under the project's former name keep working: each
    MAILBROOM_X fills in INBOXRAKE_X where that is unset. Returns the former
    names found (main.py logs a rename hint for each)."""
    former = sorted(k for k in environ if k.startswith("MAILBROOM_"))
    for old in former:
        environ.setdefault("INBOXRAKE_" + old[len("MAILBROOM_"):],
                           environ[old])
    return former


# Here, before any module reads the environment (some do at import).
FORMER_ENV = adopt_former_env(os.environ)
