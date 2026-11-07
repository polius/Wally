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

# One password for the household
PASS = "household-pass-1"

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
    client.post("/categories", json={"name": "Kids", "color": 3, "icon": "dog"})
    client.post("/tags", json={"name": "holiday"})
    r = client.put("/signin", json={"enabled": True, "password": PASS})
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
    """One device of one person: the household's keys, as the browser keeps them."""
    def __init__(self, client: TestClient, person_id: int, password: str):
        self.c, self.person, self.password = client, person_id, password
        self.house = None
        self.vault_id = None

    def login(self, code: str | None = None):
        kdf = self.c.get("/vault/kdf").json()
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
        kdf = self.c.get("/vault/kdf").json()
        return vc.from_password(self.password, kdf["salt"])[0] if kdf["salt"] else self.password

    def all(self) -> dict:
        body = self.c.get("/vault/changes?since=0").json()
        return {r["id"]: (r["v"], self.house.open(r["id"], r["v"], r["ct"])) for r in body["records"]}

def turn_on(client, person_id, password, fail_at=None):
    """Turning encryption on, as js/vault/session.js turnOn() does. Returns the secret and the recovery key."""
    kdf = client.get("/vault/kdf").json()
    current = vc.from_password(password, kdf["salt"])[0] if kdf["salt"] else password
    salt = vc.new_salt()
    login, unlock_key = vc.from_password(password, salt)
    secret, vault_id = __import__("os").urandom(32), __import__("os").urandom(16).hex()
    recovery = vc.new_recovery_key()
    rlogin, runlock = vc.from_recovery_key(vc.parse_recovery_key(recovery))
    r = client.post("/vault/convert/start", json={
        "direction": "on", "current": current, "vault_id": vault_id, "salt": salt, "login_key": login, "wrap": vc.lock(unlock_key, secret, vault_id),
        "recovery_login": rlogin, "recovery_wrap": vc.lock(runlock, secret, vault_id),
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
    return {"secret": secret, "vault_id": vault_id, "recovery": recovery, "count": len(sent), "house": house}

@pytest.fixture
def encrypted(make_client):
    client = make_client()
    alex, ana = plain_household(client)
    assert client.post("/login", json={"person_id": alex, "password": PASS}).status_code == 200
    before = export()
    result = turn_on(client, alex, PASS)
    return client, alex, ana, result, before

# ---------- turning on ----------
def test_turning_on_leaves_nothing_in_the_clear(encrypted):
    client, alex, ana, result, before = encrypted
    status = client.get("/auth/status").json()
    assert status["vault"]["on"] and status["vault"]["kdf"]
    # Every plain table is empty, and no plain backup or old file is left
    conn = sqlite3.connect(database.DB_PATH)
    for table in ("transaction", "recurringtransaction", "category", "categorycolor", "categoryicon", "tag", "importrule"):
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

def test_turning_on_keeps_only_counts_of_the_upgrade_report(make_client):
    """A household upgraded from 1.x: its report names transactions and amounts. The files go, and the
    copy in the settings (which stay in the clear) keeps only counts, for the welcome to 2.0."""
    from api import upgrade
    client = make_client()
    alex, ana = plain_household(client)
    report = {
        "from": "1.x", "to": "2.0.0", "at": "2026-11-03T10:00:00+00:00", "today": "2026-11-03", "backup": None,
        "kept": {"transactions": 5, "first": "2026-10-01", "last": "2026-10-20", "expense": "139.74", "income": "0.00",
                 "rules": 1, "categories": 4, "tags": 2, "password": True, "settings": ["currency"]},
        "removed": [{"date": "2026-12-01", "name": "Lloguer Pis Manresa", "amount": "469.83"}],
        "notes": [{"kind": "decimals", "count": 1, "examples": [{"date": "2026-10-02", "name": "Forn de pa", "amount": "1.005"}]}],
        "checked": ["transactions"],
    }
    upgrade.save(report, database.DATA_DIR)
    conn = sqlite3.connect(database.DB_PATH)
    conn.execute("INSERT OR REPLACE INTO appconfig (key, value) VALUES ('UPGRADE_REPORT', ?)", (json.dumps(report),))
    conn.commit()
    conn.close()
    assert list(database.DATA_DIR.glob("upgrade-report-*"))
    # Long enough not to turn up by chance: three digits like "469" can, in ciphertext or in a timestamp
    words = ("Lloguer", "Forn de pa", "469.83", "139.74")
    before = b"".join(f.read_bytes() for f in database.DB_PATH.parent.glob(database.DB_PATH.name + "*"))
    assert all(w.encode() in before for w in words)  # there to begin with, so their absence below means something
    assert client.post("/login", json={"person_id": alex, "password": PASS}).status_code == 200
    turn_on(client, alex, PASS)
    assert not list(database.DATA_DIR.glob("upgrade-report-*"))
    raw = database.DB_PATH.read_bytes()
    for word in words:
        assert word.encode() not in raw, word
    # The welcome still says how many came across, and the download says what was taken out
    assert client.get("/auth/status").json()["upgrade"]["kept"]["transactions"] == 5
    text = client.get("/upgrade/report").text
    assert "5 transactions" in text and "1 charge that 1.x added" in text and "taken out of this report when encryption was turned on" in text
    assert "spent" not in text

def test_the_browsers_records_open_with_the_password_from_outside(encrypted):
    client, alex, ana, result, before = encrypted
    house, items = vc.open_database(database.DB_PATH, PASS)
    for i in items:
        if i["k"] == "irule":
            i.pop("id")
    assert sorted(json.dumps(i, sort_keys=True) for i in items) == before

def test_plain_routes_and_api_keys_are_refused(encrypted):
    client, alex, *_ = encrypted
    for path in ("/transactions", "/ledger", "/recurring", "/categories", "/tags", "/rules", "/summary/monthly", f"/people/{alex}/usage"):
        assert client.get(path).status_code == 409, path
    assert client.post("/transactions", json={"name": "x", "category": "Food", "amount": "1", "date": TODAY}).status_code == 409
    # A key the server would make can't open anything: the browser makes it, with the lock
    assert client.post("/api-keys", json={"name": "phone"}).status_code == 400
    assert client.get("/config", headers={"x-api-key": "wly_whatever"}).status_code == 401
    assert client.get("/transactions", headers={"x-api-key": "wly_whatever"}).status_code == 401
    assert client.put("/signin", json={"enabled": False, "current": "x"}).status_code == 400

# ---------- API keys on an encrypted household ----------
def make_key(client, result, scope="write", name="script"):
    """As js/vault/session.js does: a key with a secret, and the household key locked under it."""
    import os
    secret = os.urandom(32)
    raw = "wly_" + secret.hex()
    wrap = vc.lock(vc.hkdf(secret, "wally api key v1"), result["secret"], result["vault_id"])
    r = client.post("/api-keys", json={"name": name, "scope": scope, "key": raw, "wrap": wrap})
    assert r.status_code == 200, r.text
    return raw

def plain_rows() -> int:
    conn = sqlite3.connect(database.DB_PATH)
    try:
        return sum(conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in conversion.PLAIN)
    finally:
        conn.close()

def test_an_api_key_reads_an_encrypted_household(encrypted):
    client, alex, ana, result, before = encrypted
    key = {"x-api-key": make_key(client, result)}
    plain = TestClient(client.app)
    rows = plain.get("/ledger", headers=key).json()["rows"]
    assert len(rows) == 6
    names = {t["name"] for t in plain.get("/transactions", headers=key).json()}
    assert {"Mercadona", "Farmacia Sant Jordi", "Dentist", "AMAZON MKTPLACE 99"} <= names
    assert "Kids" in plain.get("/categories", headers=key).json()
    assert plain.get("/summary/monthly", headers=key).status_code == 200
    # Nothing it opened is left behind in the clear
    assert plain_rows() == 0
    # Signed in in a browser, the same routes still answer from the browser only
    assert client.get("/transactions").status_code == 409

def test_an_api_key_changes_an_encrypted_household_as_a_browser_would(encrypted):
    client, alex, ana, result, before = encrypted
    b = Browser(client, alex, PASS)
    b.house, b.vault_id = result["house"], result["vault_id"]
    key = {"x-api-key": make_key(client, result)}
    plain = TestClient(client.app)
    r = plain.post("/transactions", json={"name": "Bakery", "category": "Groceries", "amount": "3.20", "date": TODAY}, headers=key)
    assert r.status_code == 200, r.text
    tx = r.json()
    recs = b.all()
    rid = tx["id"].replace("-", "")
    v, obj = recs[rid]
    assert v == 1 and obj["k"] == "tx" and obj["name"] == "Bakery" and obj["cents"] == 320 and obj["created_by"] == alex
    # A rename touches the category and every transaction in it, and nothing else
    seq = client.get("/vault/changes?since=0").json()["seq"]
    r = plain.put("/categories/Healthcare", json={"name": "Health"}, headers=key)
    assert r.status_code == 200, r.text
    changed = client.get(f"/vault/changes?since={seq}").json()["records"]
    opened = [b.house.open(c["id"], c["v"], c["ct"]) if c["ct"] else None for c in changed]
    assert {o["name"] for o in opened if o and o["k"] == "tx"} == {"Farmacia Sant Jordi"}
    assert any(o and o["k"] == "cat" and o["name"] == "Health" for o in opened)
    assert any(c["ct"] is None for c in changed)  # the old name, deleted
    # Deleting is a deletion the browsers see
    assert plain.delete(f"/transactions/{tx['id']}", headers=key).status_code == 200
    assert b.all()[rid][1] is None if rid in b.all() else True
    assert plain_rows() == 0

def test_charges_added_by_a_key_are_the_ones_a_browser_would_add(encrypted):
    client, alex, ana, result, before = encrypted
    key = {"x-api-key": make_key(client, result)}
    plain = TestClient(client.app)
    r = plain.post("/recurring", json={"name": "Gym", "category": "Health", "amount": "30", "frequency": "monthly", "startDate": "2026-08-01"}, headers=key)
    assert r.status_code == 200, r.text
    rule_id = r.json()["id"]
    b = Browser(client, alex, PASS)
    b.house = result["house"]
    made = sorted((o["date"], rid) for rid, (_, o) in b.all().items() if o and o["k"] == "tx" and o["recurringID"] == rule_id)
    assert made and all(rid == str(b.house.occurrence_id(rule_id, on)).replace("-", "") for on, rid in made)

def test_a_read_key_only_reads_and_keys_end_when_deleted(encrypted):
    client, alex, ana, result, before = encrypted
    raw = make_key(client, result, scope="read")
    plain = TestClient(client.app)
    assert plain.get("/transactions", headers={"x-api-key": raw}).status_code == 200
    r = plain.post("/transactions", json={"name": "x", "category": "Groceries", "amount": "1", "date": TODAY}, headers={"x-api-key": raw})
    assert r.status_code == 403
    # A key can't make or delete keys
    assert plain.post("/api-keys", json={"name": "more"}, headers={"x-api-key": raw}).status_code in (403, 400)
    kid = client.get("/api-keys").json()[0]["id"]
    assert plain.delete(f"/api-keys/{kid}", headers={"x-api-key": raw}).status_code == 403
    assert client.delete(f"/api-keys/{kid}").status_code == 200
    assert plain.get("/transactions", headers={"x-api-key": raw}).status_code == 401

def test_a_lock_that_opens_nothing_is_refused(encrypted):
    import os
    client, alex, ana, result, before = encrypted
    secret = os.urandom(32)
    raw = "wly_" + secret.hex()
    # Locked under the wrong key, and locking the wrong household key
    bad = vc.lock(os.urandom(32), result["secret"], result["vault_id"])
    assert client.post("/api-keys", json={"name": "x", "key": raw, "wrap": bad}).status_code == 400
    wrong = vc.lock(vc.hkdf(secret, "wally api key v1"), os.urandom(32), result["vault_id"])
    assert client.post("/api-keys", json={"name": "x", "key": raw, "wrap": wrong}).status_code == 400

def test_keys_keep_working_when_encryption_is_turned_off(encrypted):
    client, alex, ana, result, before = encrypted
    raw = make_key(client, result)
    b = Browser(client, alex, PASS)
    b.house, b.vault_id = result["house"], result["vault_id"]
    turn_off(client, b)
    plain = TestClient(client.app)
    assert len(plain.get("/ledger", headers={"x-api-key": raw}).json()["rows"]) == 6
    conn = sqlite3.connect(database.DB_PATH)
    assert conn.execute("SELECT COUNT(*) FROM apikeys WHERE wrap IS NOT NULL").fetchone()[0] == 0
    conn.close()

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
    assert client.post("/login", json={"person_id": alex, "password": PASS}).status_code == 401
    b = Browser(client, alex, PASS).login()
    assert len(b.all()) == result["count"]
    conn = sqlite3.connect(database.DB_PATH)
    stored = conn.execute("SELECT value FROM appconfig WHERE key='LOGIN_PASSWORD'").fetchone()[0]
    conn.close()
    assert PASS not in stored

def test_everyone_opens_it_with_the_same_password(encrypted):
    client, alex, ana, result, before = encrypted
    other = TestClient(client.app)
    assert other.get("/vault/kdf").json()["state"] == "key"
    b = Browser(other, ana, PASS).login()
    assert len(b.all()) == result["count"]
    assert other.get("/auth/status").json()["me"]["id"] == ana
    # No codes for anyone: those routes are gone
    assert other.post("/vault/invites", json={}).status_code in (404, 405)
    assert other.post("/vault/redeem", json={}).status_code in (404, 405)

def turn_on_two_step(client) -> str:
    setup = client.post("/two-step/setup").json()
    proof = vc.from_password(PASS, client.get("/vault/kdf").json()["salt"])[0]
    r = client.post("/two-step/confirm", json={"code": totp.code_at(setup["secret"], int(time.time() // 30)), "password": proof})
    assert r.status_code == 200, r.text
    auth_router._last_counter["value"] = -1
    return setup["secret"]

def test_an_old_52_character_kit_still_opens_the_household(encrypted):
    """Kits printed before 2.0 shipped hold 52 characters; the key's bytes go through HKDF the same way."""
    client, alex, ana, result, before = encrypted
    old = vc.new_recovery_key(52)
    assert len(old) == 64
    rlogin, runlock = vc.from_recovery_key(vc.parse_recovery_key(old))
    current = vc.from_password(PASS, client.get("/vault/kdf").json()["salt"])[0]
    r = client.post("/kit", json={"recovery_login": rlogin, "recovery_wrap": vc.lock(runlock, result["secret"], result["vault_id"]), "current": current})
    assert r.status_code == 200, r.text
    other = TestClient(client.app)
    r = other.post("/kit/recover", json={"person_id": alex, "login": rlogin})
    assert r.status_code == 200, r.text
    assert vc.unlock(runlock, r.json()["wrap"], r.json()["vault_id"]) == result["secret"]

def test_the_emergency_kit_gets_in_without_two_step(encrypted):
    client, alex, ana, result, before = encrypted
    ana_c = TestClient(client.app)
    Browser(ana_c, ana, PASS).login()
    turn_on_two_step(client)
    other = TestClient(client.app)
    rlogin, runlock = vc.from_recovery_key(vc.parse_recovery_key(result["recovery"]))
    assert other.post("/kit/recover", json={"person_id": alex, "login": "0" * 64}).status_code == 401
    assert other.post("/kit/password", json={"salt": vc.new_salt(), "new": "a" * 64, "wrap": vc.lock(b"k" * 32, b"s" * 32, "x")}).status_code == 401
    # Password forgotten and phone lost: the recovery key alone is enough
    r = other.post("/kit/recover", json={"person_id": alex, "login": rlogin})
    assert r.status_code == 200, r.text
    secret = vc.unlock(runlock, r.json()["wrap"], r.json()["vault_id"])
    assert secret == result["secret"]
    salt = vc.new_salt()
    login, unlock_key = vc.from_password("brand-new-pass", salt)
    assert other.post("/kit/password", json={"salt": salt, "new": login, "wrap": vc.lock(unlock_key, secret, r.json()["vault_id"])}).status_code == 200
    # A new password for the household: every other browser signs in again, with it
    assert client.get("/vault/key").status_code == 401 and ana_c.get("/vault/key").status_code == 401
    assert other.get("/vault/key").status_code == 200
    status = other.get("/auth/status").json()
    assert status["me"]["id"] == alex and status["two_step"]
    # The kit keeps working, and the new password opens the key
    assert other.post("/kit/recover", json={"person_id": alex, "login": rlogin}).status_code == 200
    # A new kit replaces it, made in the browser, with the password
    kdf = other.get("/vault/kdf").json()
    rec2 = vc.new_recovery_key()
    rlogin2, runlock2 = vc.from_recovery_key(vc.parse_recovery_key(rec2))
    body = {"recovery_login": rlogin2, "recovery_wrap": vc.lock(runlock2, secret, result["vault_id"])}
    assert other.post("/kit", json={**body, "current": "0" * 64}).status_code == 401
    assert other.post("/kit", json={**body, "current": vc.from_password("brand-new-pass", kdf["salt"])[0]}).json() == {"made": other.get("/auth/status").json()["kit"]}
    assert other.post("/kit/recover", json={"person_id": alex, "login": rlogin}).status_code == 401
    assert other.post("/kit/recover", json={"person_id": alex, "login": rlogin2}).status_code == 200
    third = TestClient(client.app)
    kdf = third.get("/vault/kdf").json()
    assert third.post("/login", json={"person_id": ana, "password": vc.from_password("brand-new-pass", kdf["salt"])[0]}).json()["code_needed"]

def test_nobody_can_turn_sign_in_off_from_the_server_while_encrypted(encrypted):
    client, alex, ana, result, before = encrypted
    from api import signin_off
    assert signin_off.main() == 1
    assert client.get("/auth/status").json()["signin"]

def test_changing_the_password_locks_the_key_again_and_signs_out_the_rest(encrypted):
    client, alex, ana, result, before = encrypted
    other = TestClient(client.app)
    Browser(other, ana, PASS).login()
    b = Browser(client, alex, PASS)
    salt = vc.new_salt()
    login, unlock_key = vc.from_password("changed-pass-1", salt)
    assert client.put("/password", json={"current": b.proof(), "new": login, "salt": salt}).status_code == 400
    assert client.put("/password", json={"current": "0" * 64, "new": login, "salt": salt, "wrap": vc.lock(unlock_key, result["secret"], result["vault_id"])}).status_code == 401
    r = client.put("/password", json={"current": b.proof(), "new": login, "salt": salt, "wrap": vc.lock(unlock_key, result["secret"], result["vault_id"])})
    assert r.status_code == 200, r.text
    assert other.get("/vault/key").status_code == 401
    Browser(other, ana, "changed-pass-1").login()

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
    client.post("/login", json={"person_id": alex, "password": PASS})
    ana_c = TestClient(client.app)
    ana_c.post("/login", json={"person_id": ana, "password": PASS})
    turn_on(client, alex, PASS, fail_at="start")
    r = ana_c.post("/transactions", json={"name": "x", "category": "Food", "amount": "1", "date": TODAY})
    assert r.status_code == 503 and r.json()["detail"]["paused"]["by"] == "Alex"
    assert ana_c.get("/transactions").status_code == 200
    assert ana_c.get("/auth/status").json()["vault"]["paused"] == {"by": "Alex", "direction": "on"}
    # Nobody else can start one meanwhile
    assert ana_c.post("/vault/convert/start", json={"direction": "on", "current": PASS}).status_code in (403, 409, 400)

def test_a_lost_browser_is_noticed_and_nothing_changes(make_client, monkeypatch):
    client = make_client()
    alex, ana = plain_household(client)
    client.post("/login", json={"person_id": alex, "password": PASS})
    digest, before = db_digest(), export()
    cid = turn_on(client, alex, PASS, fail_at="check")
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
    client.post("/login", json={"person_id": alex, "password": PASS})
    digest = db_digest()
    cid = turn_on(client, alex, PASS, fail_at="check")
    assert client.post("/vault/convert/finish", json={"id": cid, "count": 3}).status_code == 409
    assert db_digest() == digest and not conversion.next_path().exists()
    assert not client.get("/auth/status").json()["vault"]["on"]

def test_not_enough_disk_is_said_up_front(make_client, monkeypatch):
    client = make_client()
    alex, ana = plain_household(client)
    client.post("/login", json={"person_id": alex, "password": PASS})
    monkeypatch.setattr(conversion.shutil, "disk_usage", lambda p: shutil._ntuple_diskusage(10, 9, 1))
    r = client.post("/vault/convert/start", json={"direction": "on", "current": PASS})
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
    client.post("/login", json={"person_id": alex, "password": PASS})
    old_digest, before = db_digest(), export()
    turn_on(client, alex, PASS, fail_at="check")
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
    client.post("/login", json={"person_id": alex, "password": PASS})
    assert turn_on(client, alex, PASS)["count"] == len(before)

@pytest.mark.parametrize("step", ["switch-before-rename", "switch-between-renames", "switch-after-renames", "cleanup"])
def test_stopped_during_the_switch_finishes_it(make_client, step):
    client, old_digest, new_digest, before, alex = _stopped(make_client, step)
    assert db_digest() == new_digest
    assert not conversion.next_path().exists() and not conversion.prev_path().exists() and not conversion.journal_path().exists()
    assert client.get("/auth/status").json()["vault"]["on"]
    house, items = vc.open_database(database.DB_PATH, PASS)
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
    b = Browser(client, alex, PASS)
    b.house, b.vault_id = result["house"], result["vault_id"]
    turn_off(client, b)
    assert export() == before
    status = client.get("/auth/status").json()
    assert not status["vault"]["on"] and status["signed_in"]
    # The encrypted file is kept as a backup; the key and the kit are gone; the password still works
    assert any(x["kind"] == "encrypted" for x in client.get("/backups").json())
    conn = sqlite3.connect(database.DB_PATH)
    assert conn.execute("SELECT COUNT(*) FROM record").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM householdkey").fetchone()[0] == 0
    conn.close()
    client.post("/logout")
    kdf = client.get("/vault/kdf").json()
    assert kdf["state"] == "plain" and kdf["salt"]
    login, _ = vc.from_password(PASS, kdf["salt"])
    assert client.post("/login", json={"person_id": alex, "password": login}).status_code == 200
    # The server works on the data again
    assert client.get("/transactions").status_code == 200 and len(client.get("/ledger").json()["rows"]) == 6

def test_turning_off_needs_the_password(encrypted):
    client, alex, *_ = encrypted
    assert client.post("/vault/convert/start", json={"direction": "off", "current": "0" * 64}).status_code == 401

def test_turning_off_tells_everyone_for_a_month(encrypted):
    client, alex, ana, result, before = encrypted
    b = Browser(client, alex, PASS)
    b.house, b.vault_id = result["house"], result["vault_id"]
    turn_off(client, b)
    off = client.get("/auth/status").json()["vault"]["turned_off"]
    assert off["by"] == alex
    # Turning it on again forgets the note
    client.post("/logout")
    Browser(client, alex, PASS)
    kdf = client.get("/vault/kdf").json()
    client.post("/login", json={"person_id": alex, "password": vc.from_password(PASS, kdf["salt"])[0]})
    turn_on(client, alex, PASS)
    assert "turned_off" not in client.get("/auth/status").json()["vault"]

# ---------- WALLY_ENCRYPTION=required ----------
def test_required_saves_nothing_in_the_clear_and_stays_on(make_client, monkeypatch):
    monkeypatch.setenv("WALLY_ENCRYPTION", "required")
    client = make_client()
    alex = client.post("/people", json={"name": "Alex"}).json()["id"]
    client.headers["x-wally-person"] = str(alex)
    assert client.get("/auth/status").json()["vault"]["required"]
    r = client.post("/transactions", json={"name": "x", "category": "Food", "amount": "1", "date": TODAY})
    assert r.status_code == 409 and "encrypted" in r.json()["detail"]
    assert client.get("/transactions").status_code == 200
    # Keys open the data while a call runs: only when the host allows it
    assert client.post("/api-keys", json={"name": "phone"}).status_code == 400
    monkeypatch.setenv("WALLY_API_KEYS", "on")
    assert client.post("/api-keys", json={"name": "phone"}).status_code == 200
    monkeypatch.delenv("WALLY_API_KEYS")
    assert client.put("/signin", json={"enabled": True, "password": PASS}).status_code == 200
    client.headers.pop("x-wally-person")
    assert client.put("/signin", json={"enabled": False, "current": PASS}).status_code == 400
    result = turn_on(client, alex, PASS)
    assert result["count"] == 10  # the default categories, now sealed
    b = Browser(client, alex, PASS)
    assert client.post("/vault/convert/start", json={"direction": "off", "current": b.proof()}).status_code == 403
    assert client.put("/signin", json={"enabled": False, "current": b.proof()}).status_code == 400

def test_required_does_not_apply_to_the_demo(monkeypatch):
    from api.services.vault import required
    monkeypatch.setenv("WALLY_ENCRYPTION", "required")
    monkeypatch.setenv("DEMO", "true")
    assert not required()
    monkeypatch.setenv("DEMO", "false")
    assert required()
