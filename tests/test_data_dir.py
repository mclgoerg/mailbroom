"""An unwritable data folder (a fresh root-owned host mount under the
uid-1000 image) is named at startup and answered with a coded error instead
of a bare `Permission denied`."""
import logging

import pytest
from fastapi.testclient import TestClient

from backend import config as cfgmod
from backend import main
from backend import mailops

client = TestClient(main.app)


@pytest.fixture
def unwritable(tmp_path, monkeypatch):
    """A 'folder' that is a file: creating or writing in it fails for every
    user, root included (a chmod would not stop the root the tests run as)."""
    blocked = tmp_path / "blocked"
    blocked.write_text("")
    monkeypatch.setattr(mailops, "SNAPSHOT_DIR", blocked)
    return blocked


def test_a_writable_data_folder_is_fine(caplog):
    assert mailops.data_dir_problem() is None
    with caplog.at_level(logging.ERROR, logger="pmc.data"):
        main._check_data_dir()
    assert caplog.records == []


def test_an_unwritable_folder_is_found(unwritable):
    assert mailops.data_dir_problem() == unwritable


def test_a_read_only_config_folder_is_found(tmp_path, monkeypatch):
    blocked = tmp_path / "blocked"
    blocked.write_text("")
    monkeypatch.setattr(cfgmod, "SERVER_PATH", blocked / "server.json")
    assert mailops.data_dir_problem() == blocked


def test_startup_logs_one_error_with_the_fix(unwritable, caplog):
    with caplog.at_level(logging.ERROR, logger="pmc.data"):
        main._check_data_dir()
    assert len(caplog.records) == 1
    text = caplog.records[0].getMessage()
    assert str(unwritable) in text and "chown -R 1000:1000" in text
    assert "--user" in text


def test_the_first_api_call_answers_with_the_coded_error(unwritable, monkeypatch):
    def boom(*a, **k):
        raise PermissionError(13, "Permission denied", "/data/server.tmp")
    monkeypatch.setattr(cfgmod, "load_server", boom)
    r = client.get("/api/auth")
    assert r.status_code == 503
    assert r.json() == {"detail": mailops.DATA_NOT_WRITABLE}
    # the security-header middleware stays outermost: its headers are on
    # this answer too
    assert r.headers["x-frame-options"] == "DENY"


def test_a_permission_error_with_a_writable_folder_stays_a_failure(monkeypatch):
    def boom(*a, **k):
        raise PermissionError(13, "Permission denied")
    monkeypatch.setattr(cfgmod, "load_server", boom)
    with pytest.raises(PermissionError):
        client.get("/api/auth")


def test_saving_settings_into_an_unwritable_folder_is_coded(unwritable, monkeypatch):
    def boom(*a, **k):
        raise PermissionError(13, "Permission denied", "/data/server.tmp")
    monkeypatch.setattr(cfgmod, "update_config", boom)
    r = client.post("/api/config", json={"theme": "dark"})
    assert r.status_code == 503
    assert r.json() == {"detail": mailops.DATA_NOT_WRITABLE}


def test_the_not_admin_refusal_stays_a_403(monkeypatch):
    def boom(*a, **k):
        raise PermissionError("only the admin can change server settings")
    monkeypatch.setattr(cfgmod, "update_config", boom)
    r = client.post("/api/config", json={"theme": "dark"})
    assert r.status_code == 403
