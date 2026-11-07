"""Regression cases found by the pre-post app review."""
import pytest
from fastapi.testclient import TestClient
from backend import accounts, auth, config, mailops
from backend import rules
from backend.main import app
from conftest import FakeIMAP, make_msg, wait_delete_done


def scanned(monkeypatch, inbox, trash=None, **options):
    fake = FakeIMAP({'INBOX': inbox, 'Trash': trash or []},
                    renumber=True, **options)
    monkeypatch.setattr(mailops, 'connect', lambda cfg, name=None: fake)
    monkeypatch.setattr(mailops, '_rescan_after_restore', lambda *a, **k: False)
    mailops.run_scan()
    return fake


def test_undo_duplicate_copy_even_when_original_folder_has_same_id(monkeypatch):
    fake = scanned(monkeypatch, [make_msg(1, msgid='<same@x.example>'),
                                make_msg(2, msgid='<same@x.example>')], copyuid=True)
    mailops.delete_messages([['INBOX', 1]])
    assert wait_delete_done()['moved'] == 1
    assert mailops.undo_last()['restored'] == 1
    assert len(fake.mailbox['INBOX']) == 2 and not fake.mailbox['Trash']


def test_undo_leaves_preexisting_trash_copy_alone_without_copyuid(monkeypatch):
    fake = scanned(monkeypatch, [make_msg(1, msgid='<same@x.example>')],
                   [make_msg(10, msgid='<same@x.example>')])
    mailops.delete_messages([['INBOX', 1]])
    wait_delete_done()
    assert mailops.undo_last()['restored'] == 1
    assert [m['uid'] for m in fake.mailbox['Trash']] == [10]


def test_undo_missing_message_id_uses_copyuid(monkeypatch):
    msg = make_msg(1)
    msg['msgid'] = ''
    fake = scanned(monkeypatch, [msg], copyuid=True)
    mailops.delete_messages([['INBOX', 1]])
    wait_delete_done()
    assert accounts.get().undo_log
    assert mailops.undo_last()['restored'] == 1
    assert not fake.mailbox['Trash']


def test_unknown_copy_is_kept_for_manual_recovery(monkeypatch):
    msg = make_msg(1)
    msg['msgid'] = ''
    scanned(monkeypatch, [msg])
    mailops.delete_messages([['INBOX', 1]])
    wait_delete_done()
    with pytest.raises(RuntimeError, match='undo_copy_unknown'):
        mailops.undo_last()
    assert accounts.get().undo_log


def test_copy_store_failure_is_not_reported_as_move(monkeypatch):
    fake = scanned(monkeypatch, [make_msg(1)], move=False, uidplus=True)
    real = fake.uid
    monkeypatch.setattr(fake, 'uid', lambda cmd, *args:
                        ('NO', [b'flag refused']) if cmd == 'STORE' else real(cmd, *args))
    mailops.delete_messages([['INBOX', 1]])
    result = wait_delete_done()
    assert result['moved'] == 0 and result['error'] == mailops.CANNOT_FLAG
    assert len(fake.mailbox['INBOX']) == 1


def test_selected_messages_respect_sender_protection(monkeypatch):
    scanned(monkeypatch, [make_msg(1, frm='keep@x.example')])
    config.update_config({'protected': ['keep@x.example']})
    with pytest.raises(ValueError, match='protected_sender_selected'):
        mailops.delete_messages([['INBOX', 1]], force=True)
    assert not accounts.get().undo_log


def test_import_endpoint_change_clears_existing_secrets():
    config.update_config({'imap': {'host': 'original.example', 'user': 'me@x.example',
                                  'password': 'sentinel'},
                          'ai': {'provider': 'openai', 'api_key': 'ai-sentinel'}})
    c = TestClient(app)
    backup = c.get('/api/export_config').json()
    backup['config']['accounts']['default']['host'] = 'changed.example'
    backup['config']['ai']['provider'] = 'ollama'
    assert c.post('/api/import_config', json=backup).status_code == 200
    saved = config.load_config()
    assert saved['accounts']['default']['password'] == ''
    assert saved['ai']['api_key'] == ''


def test_oidc_identity_is_case_sensitive_and_not_email():
    a = {'sub': 'subject-A', 'email': 'first@x.example', 'email_verified': True}
    b = {**a, 'email': 'renamed@x.example'}
    assert auth.oidc_identity(a, 'https://idp.example') == auth.oidc_identity(b, 'https://idp.example')
    assert auth.oidc_identity(a, 'https://idp.example') != auth.oidc_identity({**a, 'sub': 'subject-a'}, 'https://idp.example')
    assert auth.allowed_subject({'sub': 'u', 'email': 'owner@x.example'}, []) is None


def test_recycled_admin_email_does_not_claim_bound_workspace(monkeypatch):
    config.update_config({'auth': {'mode': 'oidc', 'admin': 'owner@x.example',
        'oidc': {'issuer': 'https://idp.example', 'client_id': 'app', 'client_secret': 'secret'}}})
    claims = {'sub': 'first-id', 'email': 'owner@x.example', 'email_verified': True}
    monkeypatch.setattr(auth, 'exchange_code', lambda *a, **k: dict(claims))
    c = TestClient(app)
    def login():
        return c.get('/api/oidc/callback', params={'code': 'code', 'state': auth.make_state()}, follow_redirects=False)
    assert login().status_code == 307
    assert c.get('/api/auth').json()['is_admin']
    claims['sub'] = 'other-id'
    assert login().status_code == 307
    assert not c.get('/api/auth').json()['is_admin']


def test_open_oidc_cannot_bootstrap_admin(monkeypatch):
    server = config.load_server()
    server['auth'].update(mode='oidc', oidc={
        'issuer': 'https://idp.example', 'client_id': 'app', 'client_secret': 'secret', 'allowed': []})
    config.save_server(server)  # simulate an existing/env-bootstrapped open install
    monkeypatch.setattr(auth, 'exchange_code', lambda *a, **k: {
        'sub': 'u', 'email': 'visitor@x.example', 'email_verified': True})
    r = TestClient(app).get('/api/oidc/callback', params={'code': 'code', 'state': auth.make_state()})
    assert r.status_code == 403 and not config.load_server()['auth']['admin']


def test_rule_reports_actual_failed_job_not_queued_count(monkeypatch):
    scanned(monkeypatch, [make_msg(1)])
    rule = rules.create_rule({'name': 'review', 'query': 'from:news@shop.example'})
    rules.run_rule(rule['id'], rescan=False)
    rules.update_rule(rule['id'], {'mode': 'execute'})
    monkeypatch.setattr(mailops, '_uid_move', lambda *a, **k: False)
    with pytest.raises(RuntimeError, match=mailops.CANNOT_MOVE):
        rules.run_rule(rule['id'], rescan=False)
    result = rules.load_rules()[0]['last_run']
    assert result['acted'] == 0 and result['error'] == mailops.CANNOT_MOVE


def test_unreadable_destination_uidvalidity_refuses_the_move(monkeypatch):
    fake = scanned(monkeypatch, [make_msg(1)], copyuid=True)
    fake.uv['Trash'] = 0
    mailops.delete_messages([['INBOX', 1]])
    result = wait_delete_done()
    assert result['moved'] == 0 and result['error'].startswith(mailops.UV_UNREADABLE)
    assert len(fake.mailbox['INBOX']) == 1 and not fake.mailbox['Trash']


def test_ui_cannot_enable_sso_that_locks_out_its_owner():
    with pytest.raises(ValueError, match='administrator'):
        config.update_config({'auth': {'mode': 'oidc', 'oidc': {
            'issuer': 'https://idp.example', 'client_id': 'app', 'client_secret': 'secret'}}})
    assert config.load_server()['auth']['mode'] == 'none'


def test_undo_job_identity_distinguishes_same_label_and_count(monkeypatch):
    fake = scanned(monkeypatch, [make_msg(1), make_msg(2)], copyuid=True)
    mailops.delete_messages([['INBOX', 1]])
    wait_delete_done()
    first = dict(mailops.STATE['undo'][0])
    mailops.delete_messages([['INBOX', 2]])
    wait_delete_done()
    assert mailops.STATE['undo'][1]['id'] != first['id']
    assert mailops.undo_last(index=1, ident=first)['restored'] == 1
    assert [m['msgid'] for m in fake.mailbox['INBOX']] == ['<m1@shop.example>']


def test_cancelling_queued_work_completes_its_result(monkeypatch):
    fake = scanned(monkeypatch, [make_msg(1), make_msg(2)])
    import threading
    monkeypatch.setattr(threading.Thread, 'start', lambda self: None)
    mailops.delete_messages([['INBOX', 1]])
    completion = {}
    mailops.delete_groups('sender', ['news@shop.example'], completion=completion)
    acc = accounts.get()
    acc.cancel['delete'] = True
    mailops._delete_worker(acc)
    assert completion == {'done': True, 'moved': 0, 'error': 'action_cancelled'}
    assert len(fake.mailbox['INBOX']) == 2 and not fake.mailbox['Trash']
