"""End-to-end encryption on the server: what it keeps, what it refuses, and that turning encryption
on or off never loses or corrupts anything, even when Wally stops half-way.

The browser's side is played by tests/vault_crypto.py, a second implementation of js/vault/crypto.js.
Run with: pytest tests
"""
import hashlib
import json
import shutil
import sqlite3
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("argon2")
pytest.importorskip("cryptography")

from api import database
from api.routers import auth as auth_router
from api.services import conversion, totp
from tests import vault_crypto as vc
from tests.test_api import TODAY, expense, rule, make_client  # noqa: F401 (the fixture)

PASS = {"Alex": "alex-pass-1", "Ana": "ana-pass-1"}

def plain_household(client):
    alex = client.post("/people", json={"name": "Alex"}).json()["id"]
    ana = client.post("/people", json={"name": "Ana"}).json()["id"]
    client.headers["x-wally-person"] = str(alex)
    # Some of everything, with the awkward cases: shares, a note, tags, an import, a rule
    expense(client, name="Mercadona", amount="23.45", paid_by=alex, note="Café y pan", tags=["#weekly"])
    expense(client, name="Farmacia Sant Jordi", category="Healthcare", amount="7.10", person_id=ana)
    expense(client, name="Dentist", category="Therapy", amount="80.00", shares={str(alex): 2000, str(ana): 6000})
    rule(client, name="Netflix", amount="13.99", startDate="2026-08-27", paid_by=ana)
    client.post("/import/commit", json={"rows": [{"date": "2026-10-20", "name": "AMAZON MKTPLACE 99", "amount": "-15.20", "import_ref": "ref-1", "action": "add", "category": "Shopping"}]})
    client.post("/categories", json={"name": "Kids", "color": 3})
    client.post("/tags", json={"name": "holiday"})
    r = client.put("/signin", json={"enabled": True, "passwords": {str(alex): PASS["Alex"], str(ana): PASS["Ana"]}})
    assert r.status_code == 200, r.text
    client.headers.pop("x-wally-person", None)
    return alex, ana

def db_digest() -> str:
    return hashlib.sha256(database.DB_PATH.read_bytes()).hexdigest()

def export(client_db=None):
    from sqlmodel import Session
    from api.routers.vault import export_items
    with Session(database.engine) as db:
        items = export_items(db)
    for i in items:
        if i["k"] == "irule":
            i.pop("id")
    return sorted(json.dumps(i, sort_keys=True) for i in items)

class Browser:
    """One device of one person: their keys, as the browser keeps them."""
    def __init__(self, client: TestClient, person_id: int, password: str):
        self.c, self.person, self.password = client, person_id, password
        self.house = None
        self.vault_id = None

    def login(self, code: str | None = None):
        kdf = self.c.get(f"/vault/kdf?person_id={self.person}").json()
        login, unlock_key = vc.from_password(self.password, kdf["salt"])
        r = self.c.post("/login", json={"person_id": self.person, "password": login})
        if r.status_code == 200 and r.json().get("code_needed"):
            r = self.c.post("/login/code", json={"code": code})
        assert r.status_code == 200, r.text
        k = self.c.get("/vault/key").json()
        self.vault_id = k["vault_id"]
        self.house = vc.Household(vc.unlock(unlock_key, k["wrap"], k["vault_id"]))
        return self

    def proof(self) -> str:
        kdf = self.c.get(f"/vault/kdf?person_id={self.person}").json()
        return vc.from_password(self.password, kdf["salt"])[0] if kdf["salt"] else self.password

    def all(self) -> dict:
        body = self.c.get("/vault/changes?since=0").json()
        return {r["id"]: (r["v"], self.house.open(r["id"], r["v"], r["ct"])) for r in body["records"]}

def turn_on(client, person_id, password, others=(), fail_at=None):
    """Turning encryption on, as js/vault/session.js turnOn() does. Returns the secret, codes and recovery key."""
    kdf = client.get(f"/vault/kdf?person_id={person_id}").json()
    current = vc.from_password(password, kdf["salt"])[0] if kdf["salt"] else password
    salt = vc.new_salt()
    login, unlock_key = vc.from_password(password, salt)
    secret, vault_id = __import__("os").urandom(32), __import__("os").urandom(16).hex()
    recovery = vc.new_recovery_key()
    rlogin, runlock = vc.from_recovery_key(vc.parse_recovery_key(recovery))
    codes, invites = {}, []
    for pid in others:
        code = vc.new_code()
        clogin, cunlock = vc.from_code(vc.parse_code(code))
        codes[pid] = code
        invites.append({"person_id": pid, "login": clogin, "wrap": vc.lock(cunlock, secret, vault_id)})
    r = client.post("/vault/convert/start", json={
        "direction": "on", "current": current, "vault_id": vault_id, "salt": salt, "login_key": login, "wrap": vc.lock(unlock_key, secret, vault_id),
        "recovery_login": rlogin, "recovery_wrap": vc.lock(runlock, secret, vault_id), "invites": invites,
    })
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    if fail_at == "start":
        return cid
    house = vc.Household(secret)
    items = client.get(f"/vault/convert/export?id={cid}").json()["items"]
    sent = {}
    records = []
    for item in items:
        rid = vc.record_id(item, house)
        sent[rid] = item
        records.append({"id": rid, "ct": house.seal(rid, 1, item)})
    for i in range(0, len(records), 3):
        assert client.post("/vault/convert/records", json={"id": cid, "records": records[i:i + 3]}).status_code == 200
    back = client.get(f"/vault/convert/readback?id={cid}").json()["records"]
    assert {r["id"]: house.open(r["id"], r["v"], r["ct"]) for r in back} == sent
    if fail_at == "check":
        return cid
    r = client.post("/vault/convert/finish", json={"id": cid, "count": len(sent)})
    assert r.status_code == 200, r.text
    return {"secret": secret, "vault_id": vault_id, "codes": codes, "recovery": recovery, "count": len(sent), "house": house}

@pytest.fixture
def encrypted(make_client):
    client = make_client()
    alex, ana = plain_household(client)
    assert client.post("/login", json={"person_id": alex, "password": PASS["Alex"]}).status_code == 200
    before = export()
    result = turn_on(client, alex, PASS["Alex"], others=[ana])
    return client, alex, ana, result, before

# ---------- turning on ----------
def test_turning_on_leaves_nothing_in_the_clear(encrypted):
    client, alex, ana, result, before = encrypted
    status = client.get("/auth/status").json()
    assert status["vault"]["on"] and status["vault"]["mine"]
    assert status["vault"]["people"][str(ana)] == {"key": False, "invite": True}
    # Every plain table is empty, and no plain backup or old file is left
    conn = sqlite3.connect(database.DB_PATH)
    for table in ("transaction", "recurringtransaction", "category", "categorycolor", "tag", "importrule"):
        assert conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] == 0, table
    assert conn.execute("SELECT COUNT(*) FROM record").fetchone()[0] == result["count"] == len(before)
    conn.close()
    assert not conversion.prev_path().exists() and not conversion.next_path().exists() and not conversion.journal_path().exists()
    check = client.get("/vault/check").json()
    assert check["plain_rows"] == 0 and check["plain_backups"] == [] and check["leftover_files"] == []
    # Like `strings wally.db`: no name, note, category or tag is anywhere in the file
    raw = database.DB_PATH.read_bytes()
    for word in ("Mercadona", "Farmacia", "Therapy", "Café", "AMAZON", "Netflix", "holiday", "weekly", "Kids", "Groceries", "13.99", "23.45"):
        assert word.encode() not in raw, word

def test_the_browsers_records_open_with_the_password_from_outside(encrypted):
    client, alex, ana, result, before = encrypted
    house, items = vc.open_database(database.DB_PATH, PASS["Alex"], alex)
    for i in items:
        if i["k"] == "irule":
            i.pop("id")
    assert sorted(json.dumps(i, sort_keys=True) for i in items) == before

def test_plain_routes_and_api_keys_are_refused(encrypted):
    client, alex, *_ = encrypted
    for path in ("/transactions", "/ledger", "/recurring", "/categories", "/tags", "/rules", "/summary/monthly", f"/people/{alex}/usage"):
        assert client.get(path).status_code == 409, path
    assert client.post("/transactions", json={"name": "x", "category": "Food", "amount": "1", "date": TODAY}).status_code == 409
    assert client.post("/api-keys", json={"name": "phone"}).status_code == 400
    assert client.get("/config", headers={"x-api-key": "wly_whatever"}).status_code == 401
    assert client.put("/signin", json={"enabled": False, "current": "x"}).status_code == 400

def test_engine_and_defaults_stay_off_after_restart(encrypted, make_client):
    client, alex, *_ = encrypted
    again = make_client()
    conn = sqlite3.connect(database.DB_PATH)
    assert conn.execute("SELECT COUNT(*) FROM category").fetchone()[0] == 0
    assert conn.execute('SELECT COUNT(*) FROM "transaction"').fetchone()[0] == 0
    conn.close()
    assert again.get("/auth/status").json()["vault"]["on"]

# ---------- signing in ----------
def test_sign_in_sends_a_login_key_never_the_password(encrypted):
    client, alex, ana, result, before = encrypted
    client.post("/logout")
    # The password itself no longer works: the server has a hash of the login key only
    assert client.post("/login", json={"person_id": alex, "password": PASS["Alex"]}).status_code == 401
    b = Browser(client, alex, PASS["Alex"]).login()
    assert len(b.all()) == result["count"]
    conn = sqlite3.connect(database.DB_PATH)
    stored = conn.execute("SELECT password_hash FROM person WHERE id=?", (alex,)).fetchone()[0]
    conn.close()
    assert PASS["Alex"] not in stored

def test_someone_without_a_key_needs_their_code(encrypted):
    client, alex, ana, result, before = encrypted
    other = TestClient(client.app)
    kdf = other.get(f"/vault/kdf?person_id={ana}").json()
    assert kdf["state"] == "invite"
    r = other.post("/login", json={"person_id": ana, "password": PASS["Ana"]})
    assert r.status_code == 403 and r.json()["detail"]["needs_code"]

def redeem(c, person_id, code, password, second=None):
    clogin, cunlock = vc.from_code(vc.parse_code(code))
    r = c.post("/vault/redeem", json={"person_id": person_id, "login": clogin, **(second or {})})
    if r.status_code != 200 or r.json().get("code_needed"):
        return r, None
    secret = vc.unlock(cunlock, r.json()["wrap"], r.json()["vault_id"])
    salt = vc.new_salt()
    login, unlock_key = vc.from_password(password, salt)
    rec = vc.new_recovery_key()
    rlogin, runlock = vc.from_recovery_key(vc.parse_recovery_key(rec))
    vid = r.json()["vault_id"]
    s = c.post("/vault/setup", json={"salt": salt, "login_key": login, "wrap": vc.lock(unlock_key, secret, vid), "recovery_login": rlogin, "recovery_wrap": vc.lock(runlock, secret, vid)})
    return s, rec

def test_a_code_lets_the_second_person_in_once(encrypted):
    client, alex, ana, result, before = encrypted
    other = TestClient(client.app)
    s, rec = redeem(other, ana, result["codes"][ana], "ana-new-pass")
    assert s.status_code == 200, s.text
    assert other.get("/auth/status").json()["vault"]["mine"]
    b = Browser(other, ana, "ana-new-pass").login()
    assert len(b.all()) == result["count"]
    # One use
    third = TestClient(client.app)
    r, _ = redeem(third, ana, result["codes"][ana], "x" * 10)
    assert r.status_code == 404

def test_three_wrong_codes_cancel_it(encrypted):
    client, alex, ana, result, before = encrypted
    other = TestClient(client.app)
    for left in (2, 1):
        r, _ = redeem(other, ana, vc.new_code(), "whatever1")
        assert r.status_code == 401 and r.json()["detail"]["tries_left"] == left
    r, _ = redeem(other, ana, vc.new_code(), "whatever1")
    assert r.status_code == 401 and r.json()["detail"]["cancelled"]
    r, _ = redeem(other, ana, result["codes"][ana], "whatever1")
    assert r.status_code == 404

def test_recovery_key_replaces_the_password_but_two_step_still_asks(encrypted):
    client, alex, ana, result, before = encrypted
    # Alex turns on two-step
    setup = client.post("/me/two-step/setup").json()
    client.post("/me/two-step/confirm", json={"code": totp.code_at(setup["secret"], int(time.time() // 30))})
    auth_router._last_counter.clear()
    other = TestClient(client.app)
    rlogin, runlock = vc.from_recovery_key(vc.parse_recovery_key(result["recovery"]))
    assert other.post("/vault/recover", json={"person_id": alex, "login": "0" * 64}).status_code == 401
    r = other.post("/vault/recover", json={"person_id": alex, "login": rlogin})
    assert r.json() == {"code_needed": True}
    assert other.post("/vault/setup", json={"salt": vc.new_salt(), "login_key": "a" * 64, "wrap": vc.lock(b"k" * 32, b"s" * 32, "x")}).status_code == 401
    r = other.post("/vault/recover", json={"person_id": alex, "login": rlogin, "code": totp.code_at(setup["secret"], int(time.time() // 30) + 1)})
    assert r.status_code == 200, r.text
    secret = vc.unlock(runlock, r.json()["wrap"], r.json()["vault_id"])
    assert secret == result["secret"]
    salt = vc.new_salt()
    login, unlock_key = vc.from_password("brand-new-pass", salt)
    assert other.post("/vault/setup", json={"salt": salt, "login_key": login, "wrap": vc.lock(unlock_key, secret, r.json()["vault_id"])}).status_code == 200
    # The old browser was signed out; the recovery key still works afterwards
    assert client.get("/vault/key").status_code == 401
    assert other.post("/vault/recover", json={"person_id": alex, "login": rlogin}).json() == {"code_needed": True}

def test_password_txt_turns_off_two_step_but_opens_nothing(encrypted):
    client, alex, ana, result, before = encrypted
    setup = client.post("/me/two-step/setup").json()
    client.post("/me/two-step/confirm", json={"code": totp.code_at(setup["secret"], int(time.time() // 30))})
    other = TestClient(client.app)
    one_time = None
    other.post("/login/recover", json={"person_id": alex})
    for line in Path(auth_router.recovery_file()).read_text().splitlines():
        if line.startswith("Alex: "):
            one_time = line.split(": ", 1)[1]
    # As a password it does nothing: the server never compares typed passwords any more
    assert other.post("/login", json={"person_id": alex, "password": one_time}).status_code == 401
    rlogin, _ = vc.from_recovery_key(vc.parse_recovery_key(result["recovery"]))
    r = other.post("/vault/recover", json={"person_id": alex, "login": rlogin, "recovery_code": one_time})
    assert r.status_code == 200 and "wrap" in r.json()
    assert not client.get("/auth/status").json()["me"]["two_step"]

def test_helping_someone_back_in_is_seen_by_everyone(encrypted):
    client, alex, ana, result, before = encrypted
    ana_c = TestClient(client.app)
    redeem(ana_c, ana, result["codes"][ana], "ana-new-pass")
    alex_b = Browser(client, alex, PASS["Alex"])
    alex_b.vault_id = result["vault_id"]
    # Alex makes a code for Ana: it needs Alex's password
    code = vc.new_code()
    clogin, cunlock = vc.from_code(vc.parse_code(code))
    body = {"person_id": ana, "current": "f" * 64, "login": clogin, "wrap": vc.lock(cunlock, result["secret"], result["vault_id"])}
    assert client.post("/vault/invites", json=body).status_code == 401
    r = client.post("/vault/invites", json={**body, "current": alex_b.proof()})
    assert r.status_code == 200 and r.json()["kind"] == "help"
    assert client.post("/vault/invites", json={**body, "person_id": alex, "current": alex_b.proof()}).status_code == 400
    helped = TestClient(client.app)
    s, rec = redeem(helped, ana, code, "ana-third-pass")
    assert s.status_code == 200
    # Every device of Ana's was signed out, and the banner is there for all
    assert ana_c.get("/vault/key").status_code == 401
    events = client.get("/auth/status").json()["vault"]["events"]
    assert events[0]["kind"] == "helped" and events[0]["person_id"] == ana and events[0]["by"] == alex

def test_changing_the_password_locks_the_key_again_and_signs_out_the_rest(encrypted):
    client, alex, ana, result, before = encrypted
    other = TestClient(client.app)
    Browser(other, alex, PASS["Alex"]).login()
    b = Browser(client, alex, PASS["Alex"])
    salt = vc.new_salt()
    login, unlock_key = vc.from_password("changed-pass-1", salt)
    assert client.put("/me/password", json={"current": b.proof(), "new": login, "salt": salt}).status_code == 400
    r = client.put("/me/password", json={"current": b.proof(), "new": login, "salt": salt, "wrap": vc.lock(unlock_key, result["secret"], result["vault_id"])})
    assert r.status_code == 200, r.text
    assert other.get("/vault/key").status_code == 401
    client.post("/logout")
    Browser(client, alex, "changed-pass-1").login()

# ---------- records ----------
def test_batches_are_all_or_nothing_and_conflicts_say_what_changed(encrypted):
    client, alex, ana, result, before = encrypted
    h = result["house"]
    rid_a, rid_b = "a" * 32, "b" * 32
    r = client.post("/vault/batch", json={"ops": [{"id": rid_a, "base": 0, "ct": h.seal(rid_a, 1, {"k": "tag", "name": "one"})}]})
    assert r.status_code == 200 and r.json()["versions"] == {rid_a: 1}
    seq = r.json()["seq"]
    # Another device saved rid_a meanwhile: base 0 is stale, and rid_b is not saved either
    r = client.post("/vault/batch", json={"ops": [{"id": rid_b, "base": 0, "ct": h.seal(rid_b, 1, {"k": "tag", "name": "two"})},
                                                  {"id": rid_a, "base": 0, "ct": h.seal(rid_a, 1, {"k": "tag", "name": "uno"})}]})
    assert r.status_code == 409
    conflict = r.json()["detail"]["conflicts"]
    assert [c["id"] for c in conflict] == [rid_a] and h.open(rid_a, conflict[0]["v"], conflict[0]["ct"])["name"] == "one"
    assert rid_b not in client.get(f"/vault/changes?since={seq - 1}").json()["records"]
    # Two devices adding the same recurring charge: the second is skipped, not an error
    r = client.post("/vault/batch", json={"ops": [{"id": rid_a, "base": 0, "ct": h.seal(rid_a, 1, {"k": "tag", "name": "x"}), "if_absent": True}]})
    assert r.status_code == 200 and r.json()["skipped"] == [rid_a]
    # Deleting leaves a tombstone: changes since show it, a full download does not
    r = client.post("/vault/batch", json={"ops": [{"id": rid_a, "base": 1, "ct": None}]})
    assert r.json()["versions"] == {rid_a: 2}
    since = client.get(f"/vault/changes?since={seq}").json()["records"]
    assert since == [{"id": rid_a, "v": 2, "seq": r.json()["seq"], "ct": None}]
    assert rid_a not in {x["id"] for x in client.get("/vault/changes?since=0").json()["records"]}
    # A record moved to another id or version doesn't open: the server can't swap them
    ct = h.seal(rid_b, 1, {"k": "tag", "name": "two"})
    with pytest.raises(Exception):
        h.open(rid_a, 1, ct)
    with pytest.raises(Exception):
        h.open(rid_b, 2, ct)

def test_bad_records_are_refused(encrypted):
    client, *_ = encrypted
    for op in ({"id": "nothex", "base": 0, "ct": vc.b64(b"x" * 100)}, {"id": "c" * 32, "base": 0, "ct": vc.b64(b"x" * 10)},
               {"id": "c" * 32, "base": -1, "ct": None}, {"id": "c" * 32, "base": 0, "ct": "%%%"}):
        assert client.post("/vault/batch", json={"ops": [op]}).status_code == 400, op
    assert client.post("/vault/batch", json={"ops": [{"id": "c" * 32, "base": 0, "ct": None}] * 2}).status_code == 400

def test_old_tombstones_are_forgotten_and_old_devices_download_again(encrypted):
    client, alex, ana, result, before = encrypted
    from sqlmodel import Session
    from api.services.vault import purge_tombstones
    h = result["house"]
    rid = "d" * 32
    client.post("/vault/batch", json={"ops": [{"id": rid, "base": 0, "ct": h.seal(rid, 1, {"k": "tag", "name": "t"})}]})
    seq = client.post("/vault/batch", json={"ops": [{"id": rid, "base": 1, "ct": None}]}).json()["seq"]
    with Session(database.engine) as db:
        assert purge_tombstones(db, days=0) == 1
    assert client.get("/vault/changes?since=1").status_code == 410
    assert client.get(f"/vault/changes?since={seq}").status_code == 200
    assert client.get("/vault/changes?since=0").status_code == 200

def test_removing_a_person_moves_their_records_in_the_same_save(encrypted):
    client, alex, ana, result, before = encrypted
    h = result["house"]
    rid = "e" * 32
    r = client.request("DELETE", f"/people/{ana}", json={"move_to": alex, "ops": [{"id": rid, "base": 0, "ct": h.seal(rid, 1, {"k": "tag", "name": "moved"})}]})
    assert r.status_code == 200 and r.json()["versions"] == {rid: 1}
    assert [p["id"] for p in client.get("/people").json()] == [alex]
    # A stale save keeps the person too
    client.post("/people", json={"name": "Sam"})
    sam = [p for p in client.get("/people").json() if p["name"] == "Sam"][0]["id"]
    r = client.request("DELETE", f"/people/{sam}", json={"ops": [{"id": rid, "base": 0, "ct": h.seal(rid, 1, {"k": "tag", "name": "x"})}]})
    assert r.status_code == 409 and sam in [p["id"] for p in client.get("/people").json()]

# ---------- the pause ----------
def test_the_household_is_read_only_while_converting(make_client):
    client = make_client()
    alex, ana = plain_household(client)
    client.post("/login", json={"person_id": alex, "password": PASS["Alex"]})
    ana_c = TestClient(client.app)
    ana_c.post("/login", json={"person_id": ana, "password": PASS["Ana"]})
    turn_on(client, alex, PASS["Alex"], others=[ana], fail_at="start")
    r = ana_c.post("/transactions", json={"name": "x", "category": "Food", "amount": "1", "date": TODAY})
    assert r.status_code == 503 and r.json()["detail"]["paused"]["by"] == "Alex"
    assert ana_c.get("/transactions").status_code == 200
    assert ana_c.get("/auth/status").json()["vault"]["paused"] == {"by": "Alex", "direction": "on"}
    # Nobody else can start one meanwhile
    assert ana_c.post("/vault/convert/start", json={"direction": "on", "current": PASS["Ana"]}).status_code in (403, 409, 400)

def test_a_lost_browser_is_noticed_and_nothing_changes(make_client, monkeypatch):
    client = make_client()
    alex, ana = plain_household(client)
    client.post("/login", json={"person_id": alex, "password": PASS["Alex"]})
    digest, before = db_digest(), export()
    cid = turn_on(client, alex, PASS["Alex"], others=[ana], fail_at="check")
    assert conversion.next_path().exists()
    later = time.time() + conversion.PAUSE_SECONDS + 1
    monkeypatch.setattr(conversion.time, "time", lambda: later)
    assert client.get("/auth/status").json()["vault"]["paused"] is None
    assert not conversion.next_path().exists() and not conversion.journal_path().exists()
    assert client.post("/vault/convert/finish", json={"id": cid, "count": 1}).status_code == 409
    assert db_digest() == digest and export() == before

def test_a_wrong_count_switches_nothing(make_client):
    client = make_client()
    alex, ana = plain_household(client)
    client.post("/login", json={"person_id": alex, "password": PASS["Alex"]})
    digest = db_digest()
    cid = turn_on(client, alex, PASS["Alex"], fail_at="check")
    assert client.post("/vault/convert/finish", json={"id": cid, "count": 3}).status_code == 409
    assert db_digest() == digest and not conversion.next_path().exists()
    assert not client.get("/auth/status").json()["vault"]["on"]

def test_not_enough_disk_is_said_up_front(make_client, monkeypatch):
    client = make_client()
    alex, ana = plain_household(client)
    client.post("/login", json={"person_id": alex, "password": PASS["Alex"]})
    monkeypatch.setattr(conversion.shutil, "disk_usage", lambda p: shutil._ntuple_diskusage(10, 9, 1))
    r = client.post("/vault/convert/start", json={"direction": "on", "current": PASS["Alex"]})
    # The password is checked first; then the space
    assert r.status_code in (400, 507)
    digest = db_digest()
    with pytest.raises(Exception):
        conversion.start("on", alex, "Alex")
    assert db_digest() == digest and not conversion.journal_path().exists()

# ---------- Wally stops half-way: on the next start, wally.db is the old file or the new one, never neither ----------
def _stopped(make_client, step):
    """Build a conversion to the point where the browser has checked everything, then stop at `step`
    as if the container died, and start Wally again."""
    client = make_client()
    alex, ana = plain_household(client)
    client.post("/login", json={"person_id": alex, "password": PASS["Alex"]})
    old_digest, before = db_digest(), export()
    turn_on(client, alex, PASS["Alex"], others=[ana], fail_at="check")
    c = conversion.current()
    conversion._close_next()
    database.engine.dispose()
    new_digest = hashlib.sha256(conversion.next_path().read_bytes()).hexdigest()
    journal = {k: c[k] for k in ("id", "direction", "step", "by", "started")}
    db, nxt, prev = database.DB_PATH, conversion.next_path(), conversion.prev_path()
    if step == "build":
        pass
    elif step == "switch-before-rename":
        conversion.write_journal({**journal, "step": "switch"})
    elif step == "switch-between-renames":
        conversion.write_journal({**journal, "step": "switch"})
        db.rename(prev)
    elif step == "switch-after-renames":
        conversion.write_journal({**journal, "step": "switch"})
        db.rename(prev)
        nxt.rename(db)
    elif step == "cleanup":
        conversion.write_journal({**journal, "step": "cleanup"})
        db.rename(prev)
        nxt.rename(db)
    elif step == "torn-journal":
        conversion.journal_path().write_text('{"id": "x", "st')
    client.__exit__(None, None, None)
    database.STATE.pop("conversion", None)
    again = make_client()
    return again, old_digest, new_digest, before, alex

@pytest.mark.parametrize("step", ["build", "torn-journal"])
def test_stopped_before_the_switch_keeps_the_old_file(make_client, step):
    client, old_digest, new_digest, before, alex = _stopped(make_client, step)
    assert db_digest() == old_digest
    assert not conversion.next_path().exists() and not conversion.journal_path().exists()
    assert not client.get("/auth/status").json()["vault"]["on"]
    assert export() == before
    # And it can be tried again
    client.post("/login", json={"person_id": alex, "password": PASS["Alex"]})
    assert turn_on(client, alex, PASS["Alex"])["count"] == len(before)

@pytest.mark.parametrize("step", ["switch-before-rename", "switch-between-renames", "switch-after-renames", "cleanup"])
def test_stopped_during_the_switch_finishes_it(make_client, step):
    client, old_digest, new_digest, before, alex = _stopped(make_client, step)
    assert db_digest() == new_digest
    assert not conversion.next_path().exists() and not conversion.prev_path().exists() and not conversion.journal_path().exists()
    assert client.get("/auth/status").json()["vault"]["on"]
    house, items = vc.open_database(database.DB_PATH, PASS["Alex"], alex)
    for i in items:
        if i["k"] == "irule":
            i.pop("id")
    assert sorted(json.dumps(i, sort_keys=True) for i in items) == before

# ---------- turning off: plain, encrypted, plain again, identical ----------
def turn_off(client, browser: Browser, fail_at=None):
    r = client.post("/vault/convert/start", json={"direction": "off", "current": browser.proof()})
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    items = [obj for _, obj in browser.all().values()]
    r = client.post("/vault/convert/plain", json={"id": cid, "items": items})
    assert r.status_code == 200, r.text
    back = client.get(f"/vault/convert/readback?id={cid}").json()["items"]
    def key(i):
        i = dict(i)
        if i["k"] == "irule":
            i.pop("id")
        return json.dumps(i, sort_keys=True)
    assert sorted(map(key, back)) == sorted(map(key, items))
    if fail_at:
        return cid
    r = client.post("/vault/convert/finish", json={"id": cid, "count": len(items)})
    assert r.status_code == 200, r.text

def test_plain_encrypted_plain_is_identical(encrypted):
    client, alex, ana, result, before = encrypted
    b = Browser(client, alex, PASS["Alex"])
    b.house, b.vault_id = result["house"], result["vault_id"]
    turn_off(client, b)
    assert export() == before
    status = client.get("/auth/status").json()
    assert not status["vault"]["on"] and status["signed_in"]
    # The encrypted file is kept as a backup; codes and keys are gone; passwords still work
    assert any(x["kind"] == "encrypted" for x in client.get("/backups").json())
    conn = sqlite3.connect(database.DB_PATH)
    assert conn.execute("SELECT COUNT(*) FROM record").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM vaultkey").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM invite").fetchone()[0] == 0
    conn.close()
    client.post("/logout")
    kdf = client.get(f"/vault/kdf?person_id={alex}").json()
    assert kdf["state"] == "plain" and kdf["salt"]
    login, _ = vc.from_password(PASS["Alex"], kdf["salt"])
    assert client.post("/login", json={"person_id": alex, "password": login}).status_code == 200
    # The server works on the data again
    assert client.get("/transactions").status_code == 200 and len(client.get("/ledger").json()["rows"]) == 6

def test_turning_off_needs_the_password(encrypted):
    client, alex, *_ = encrypted
    assert client.post("/vault/convert/start", json={"direction": "off", "current": "0" * 64}).status_code == 401

def test_turning_off_tells_everyone_for_a_month(encrypted):
    client, alex, ana, result, before = encrypted
    b = Browser(client, alex, PASS["Alex"])
    b.house, b.vault_id = result["house"], result["vault_id"]
    turn_off(client, b)
    off = client.get("/auth/status").json()["vault"]["turned_off"]
    assert off["by"] == alex
    # Turning it on again forgets the note
    client.post("/logout")
    Browser(client, alex, PASS["Alex"])
    kdf = client.get(f"/vault/kdf?person_id={alex}").json()
    client.post("/login", json={"person_id": alex, "password": vc.from_password(PASS["Alex"], kdf["salt"])[0]})
    turn_on(client, alex, PASS["Alex"])
    assert "turned_off" not in client.get("/auth/status").json()["vault"]
