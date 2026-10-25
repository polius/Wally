"""API tests: money maths, the recurring engine, sign-in, settle up, import matching, the upgrade from 1.x.

Run with: pytest tests
"""
import shutil
import sqlite3
import time
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import database
from api.routers import auth as auth_router
from api.services import totp

FIXTURES = Path(__file__).parent / "fixtures"
TODAY = "2026-10-24"

@pytest.fixture
def make_client(tmp_path, monkeypatch):
    monkeypatch.setenv("WALLY_RECOVERY_FILE", str(tmp_path / "password.txt"))
    monkeypatch.setenv("WALLY_TODAY", TODAY)
    auth_router._failures.clear()
    auth_router._last_counter.clear()
    clients = []

    def make(db_file: Path | None = None):
        if db_file:
            shutil.copy(db_file, tmp_path / "wally.db")
        database.configure(tmp_path)
        from api.main import app
        client = TestClient(app)
        client.__enter__()
        clients.append(client)
        return client

    yield make
    for client in clients:
        client.__exit__(None, None, None)

@pytest.fixture
def client(make_client):
    return make_client()

@pytest.fixture
def couple(client):
    alex = client.post("/people", json={"name": "Alex"}).json()
    ana = client.post("/people", json={"name": "Ana"}).json()
    client.headers["x-wally-person"] = str(alex["id"])
    return client, alex["id"], ana["id"]

def expense(client, **kw):
    body = {"name": "Mercadona", "category": "Groceries", "amount": "10.00", "date": TODAY, **kw}
    r = client.post("/transactions", json=body)
    assert r.status_code == 200, r.text
    return r.json()

# ---------- shares ----------
def test_shared_cost_rounds_spare_cent_to_payer(couple):
    client, alex, ana = couple
    t = expense(client, amount="10.01", paid_by=alex)
    assert t["shares"] == {str(alex): 501, str(ana): 500}
    t = expense(client, amount="10.01", paid_by=ana)
    assert t["shares"] == {str(alex): 500, str(ana): 501}

def test_custom_shares_must_add_up(couple):
    client, alex, ana = couple
    r = client.post("/transactions", json={"name": "x", "category": "Food", "amount": "30", "date": TODAY, "shares": {str(alex): 1000, str(ana): 1000}})
    assert r.status_code == 400
    t = expense(client, amount="30", shares={str(alex): 2000, str(ana): 1000})
    assert t["shares"] == {str(alex): 2000, str(ana): 1000}

def test_own_transaction_has_no_shares(couple):
    client, alex, ana = couple
    t = expense(client, person_id=ana, paid_by=alex, shares={str(ana): 1000})
    assert t["person_id"] == ana and t["shares"] is None and t["paid_by"] is None
    assert t["created_by"] == alex

def test_changing_amount_resplits(couple):
    client, alex, ana = couple
    t = expense(client, amount="10.00", paid_by=alex)
    r = client.put(f"/transactions/{t['id']}", json={"amount": "7.03"})
    assert r.json()["shares"] == {str(alex): 352, str(ana): 351}

def test_tags_are_cleaned_and_created(couple):
    client, *_ = couple
    t = expense(client, tags=["#coffee", "coffee", " holiday "])
    assert t["tags"] == ["coffee", "holiday"]
    assert {"coffee", "holiday"} <= set(client.get("/tags").json())

# ---------- recurring engine ----------
def rule(client, **kw):
    body = {"name": "Netflix", "category": "Entertainment", "amount": "13.99", "frequency": "monthly", "startDate": "2026-01-31", **kw}
    r = client.post("/recurring", json=body)
    assert r.status_code == 200, r.text
    return r.json()

def made(client, rule_id):
    return sorted(t["date"] for t in client.get("/transactions").json() if t["recurringID"] == rule_id)

def test_month_end_falls_on_last_day_and_never_drifts(client):
    r = rule(client)
    assert made(client, r["id"]) == ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30"]

def test_future_dates_are_never_stored(client):
    r = rule(client, startDate="2026-10-20")
    assert made(client, r["id"]) == ["2026-10-20"]
    assert r["last_run"] == TODAY

def test_29_february_falls_on_28(client):
    r = rule(client, startDate="2024-02-29", frequency="yearly")
    assert made(client, r["id"]) == ["2024-02-29", "2025-02-28", "2026-02-28"]

def test_every_n_and_end_after(client):
    r = rule(client, name="Swim", startDate="2026-09-05", frequency="weekly", interval=2, endDate="2026-10-03")
    assert made(client, r["id"]) == ["2026-09-05", "2026-09-19", "2026-10-03"]

def test_engine_catches_up_and_never_duplicates(client, monkeypatch):
    from api.services.engine import run_all
    r = rule(client, startDate="2026-10-01", frequency="daily")
    assert len(made(client, r["id"])) == 24
    monkeypatch.setenv("WALLY_TODAY", "2026-10-30")
    with database.Session(database.engine) as db:
        assert run_all(db) == 6
        assert run_all(db) == 0
    assert len(made(client, r["id"])) == 30

def test_pause_adds_nothing_and_resume_offers_missed(client, monkeypatch):
    from api.services.engine import run_all
    r = rule(client, startDate="2026-10-01", frequency="daily")
    client.post(f"/recurring/{r['id']}/pause")
    monkeypatch.setenv("WALLY_TODAY", "2026-10-27")
    with database.Session(database.engine) as db:
        run_all(db)
    assert len(made(client, r["id"])) == 24
    resumed = client.post(f"/recurring/{r['id']}/resume").json()
    assert resumed["missed"] == ["2026-10-25", "2026-10-26", "2026-10-27"]
    assert len(made(client, r["id"])) == 24
    client.post(f"/recurring/{r['id']}/missed", json={"add": True})
    assert len(made(client, r["id"])) == 27

def test_change_from_next_charge_splits_the_rule(client):
    r = rule(client)
    new = client.put(f"/recurring/{r['id']}", json={"amount": "15.99", "applyTo": "later"}).json()
    assert new["id"] != r["id"]
    assert new["startDate"] == "2026-10-31" and new["anchor_day"] == 31
    old = client.get(f"/recurring/{r['id']}").json()[0]
    assert old["endDate"] == "2026-10-30"
    past = [t for t in client.get("/transactions").json() if t["recurringID"] == r["id"]]
    assert {t["amount"] for t in past} == {"13.99"}

def test_split_rule_keeps_the_31st_after_a_short_month(client, monkeypatch):
    from api.services.engine import run_all
    monkeypatch.setenv("WALLY_TODAY", "2026-11-05")
    r = rule(client)
    new = client.put(f"/recurring/{r['id']}", json={"amount": "15.99", "applyTo": "later"}).json()
    assert new["startDate"] == "2026-11-30"
    monkeypatch.setenv("WALLY_TODAY", "2027-01-05")
    with database.Session(database.engine) as db:
        run_all(db)
    assert made(client, new["id"]) == ["2026-11-30", "2026-12-31"]

def test_change_all_rewrites_past(client):
    r = rule(client)
    client.put(f"/recurring/{r['id']}", json={"amount": "15.99", "category": "Utilities", "applyTo": "all"})
    past = [t for t in client.get("/transactions").json() if t["recurringID"] == r["id"]]
    assert len(past) == 9 and {(t["amount"], t["category"]) for t in past} == {("15.99", "Utilities")}

def test_delete_rule_keeps_or_removes_past(client):
    r1, r2 = rule(client), rule(client, name="Gym")
    client.request("DELETE", f"/recurring/{r1['id']}", json={"applyTo": "future"})
    client.request("DELETE", f"/recurring/{r2['id']}", json={"applyTo": "all"})
    names = [t["name"] for t in client.get("/transactions").json()]
    assert names.count("Netflix") == 9 and names.count("Gym") == 0

# ---------- sign-in ----------
def turn_on_signin(client, alex, ana):
    r = client.put("/signin", json={"enabled": True, "passwords": {str(alex): "alex-pass-1", str(ana): "ana-pass-1"}})
    assert r.status_code == 200, r.text
    client.headers.pop("x-wally-person", None)
    client.cookies.clear()

def test_signin_per_person(couple):
    client, alex, ana = couple
    turn_on_signin(client, alex, ana)
    assert client.get("/transactions").status_code == 401
    status = client.get("/auth/status").json()
    assert status["signin"] and not status["signed_in"] and [p["name"] for p in status["people"]] == ["Alex", "Ana"]

    r = client.post("/login", json={"person_id": ana, "password": "wrong"})
    assert r.status_code == 401 and r.json()["detail"]["tries_left"] == 4
    r = client.post("/login", json={"person_id": ana, "password": "ana-pass-1"})
    assert r.json() == {"ok": True, "code_needed": False, "must_change_password": True}
    cookie = r.headers["set-cookie"]
    assert "HttpOnly" in cookie and "Max-Age=31536000" in cookie
    me = client.get("/auth/status").json()
    assert me["me"]["name"] == "Ana" and me["must_change_password"]

    # Created by comes from sign-in, not from what the browser says
    t = client.post("/transactions", json={"name": "x", "category": "Food", "amount": "5", "date": TODAY}, headers={"x-wally-person": str(alex)}).json()
    assert t["created_by"] == ana

def test_five_wrong_tries_wait(couple):
    client, alex, ana = couple
    turn_on_signin(client, alex, ana)
    for _ in range(5):
        assert client.post("/login", json={"person_id": alex, "password": "nope"}).status_code == 401
    r = client.post("/login", json={"person_id": alex, "password": "alex-pass-1"})
    assert r.status_code == 429 and 0 < r.json()["detail"]["retry_after"] <= 30
    auth_router._failures[str(alex)][-1] -= 31
    assert client.post("/login", json={"person_id": alex, "password": "alex-pass-1"}).status_code == 200

def test_two_step_and_recovery_codes(couple):
    client, alex, ana = couple
    turn_on_signin(client, alex, ana)
    client.post("/login", json={"person_id": alex, "password": "alex-pass-1"})
    setup = client.post("/me/two-step/setup").json()
    assert setup["uri"].startswith("otpauth://totp/Wally:Alex?secret=")
    assert client.post("/me/two-step/confirm", json={"code": "000000"}).status_code == 400
    codes = client.post("/me/two-step/confirm", json={"code": totp.code_at(setup["secret"], int(time.time() // 30))}).json()["recovery_codes"]
    assert len(codes) == 10 and len(set(codes)) == 10

    client.post("/logout")
    r = client.post("/login", json={"person_id": alex, "password": "alex-pass-1"})
    assert r.json()["code_needed"] is True
    assert client.get("/transactions").status_code == 401
    r = client.post("/login/code", json={"code": "123456"})
    assert r.status_code == 401 and "30 seconds" in r.json()["detail"]["message"]
    r = client.post("/login/code", json={"recovery_code": codes[0].upper()})
    assert r.status_code == 200 and r.json()["recovery_codes_left"] == 9
    assert client.get("/transactions").status_code == 200

    # A recovery code works once
    client.post("/logout")
    client.post("/login", json={"person_id": alex, "password": "alex-pass-1"})
    assert client.post("/login/code", json={"recovery_code": codes[0]}).status_code == 401

def test_forgot_password_writes_file_and_turns_two_step_off(couple, tmp_path):
    client, alex, ana = couple
    turn_on_signin(client, alex, ana)
    client.post("/login", json={"person_id": alex, "password": "alex-pass-1"})
    secret = client.post("/me/two-step/setup").json()["secret"]
    client.post("/me/two-step/confirm", json={"code": totp.code_at(secret, int(time.time() // 30))})
    client.post("/logout")

    client.post("/login/recover", json={"person_id": alex})
    line = (tmp_path / "password.txt").read_text().strip()
    name, one_time = line.split(": ")
    assert name == "Alex"
    r = client.post("/login", json={"person_id": alex, "password": one_time})
    assert r.json() == {"ok": True, "code_needed": False, "must_change_password": True}
    assert not (tmp_path / "password.txt").exists()
    assert client.get("/auth/status").json()["me"]["two_step"] is False
    assert client.put("/me/password", json={"new": "short"}).status_code == 400
    assert client.put("/me/password", json={"new": "a-new-password"}).status_code == 200
    client.post("/logout")
    assert client.post("/login", json={"person_id": alex, "password": "a-new-password"}).status_code == 200

def test_password_change_ends_other_sessions(couple, make_client):
    client, alex, ana = couple
    turn_on_signin(client, alex, ana)
    client.post("/login", json={"person_id": alex, "password": "alex-pass-1"})
    other = TestClient(client.app)
    other.post("/login", json={"person_id": alex, "password": "alex-pass-1"})
    assert other.get("/transactions").status_code == 200
    # This browser, the other one, and the one that turned sign-in on
    assert len(client.get("/me/sessions").json()) == 3
    client.put("/me/password", json={"current": "alex-pass-1", "new": "another-pass"})
    assert other.get("/transactions").status_code == 401
    assert client.get("/transactions").status_code == 200
    assert len(client.get("/me/sessions").json()) == 1

def test_sign_out_others(couple):
    client, alex, ana = couple
    turn_on_signin(client, alex, ana)
    client.post("/login", json={"person_id": alex, "password": "alex-pass-1"})
    other = TestClient(client.app)
    other.post("/login", json={"person_id": alex, "password": "alex-pass-1"})
    client.delete("/me/sessions/others")
    assert other.get("/transactions").status_code == 401
    assert [s["current"] for s in client.get("/me/sessions").json()] == [True]

def test_require_two_step(couple):
    client, alex, ana = couple
    turn_on_signin(client, alex, ana)
    client.post("/login", json={"person_id": alex, "password": "alex-pass-1"})
    client.put("/signin", json={"enabled": True, "require_two_step": True})
    assert client.get("/auth/status").json()["needs_two_step"] is True

def test_api_key_belongs_to_person(couple):
    client, alex, ana = couple
    client.headers["x-wally-person"] = str(ana)
    key = client.post("/api-keys", json={"name": "Shortcut"}).json()
    assert key["key"].startswith("wly_") and key["person_id"] == ana
    turn_on_signin(client, alex, ana)
    t = client.post("/transactions", json={"name": "Café", "category": "Food", "amount": "2.5", "date": TODAY}, headers={"x-api-key": key["key"]}).json()
    assert t["created_by"] == ana
    assert client.get("/transactions", headers={"x-api-key": "wly_nope"}).status_code == 401

def test_turning_signin_on_needs_passwords(couple):
    client, alex, ana = couple
    r = client.put("/signin", json={"enabled": True, "passwords": {str(alex): "alex-pass-1"}})
    assert r.status_code == 400 and r.json()["detail"]["missing"] == ["Ana"]

# ---------- settle up ----------
def test_settle_up(couple):
    client, alex, ana = couple
    expense(client, amount="100", paid_by=alex)
    expense(client, amount="30", paid_by=ana)
    expense(client, amount="50", person_id=ana)
    s = client.get("/settlements").json()
    assert s["net"] == {str(alex): "35.00", str(ana): "-35.00"}
    assert s["transfers"] == [{"from": ana, "to": alex, "amount": "35.00"}]
    client.post("/settlements", json={"date": TODAY, "from_person": ana, "to_person": alex, "amount": "35"})
    assert client.get("/settlements").json()["transfers"] == []

# ---------- summary and search ----------
def test_monthly_summary_counts_shares(couple):
    client, alex, ana = couple
    expense(client, amount="10.01", paid_by=alex)
    expense(client, amount="20", person_id=ana, date="2026-09-03")
    client.post("/transactions", json={"name": "Salary", "category": "Income", "type": "income", "amount": "2000", "date": TODAY, "person_id": alex})
    s = client.get("/summary/monthly", params={"from": "2026-09", "to": "2026-10"}).json()
    sep, octo = s["months"]
    assert sep["expense"] == 2000 and sep["people"][str(ana)]["expense"] == 2000
    assert octo["expense"] == 1001 and octo["income"] == 200000
    assert octo["categories"]["Groceries"]["people"] == {str(alex): 501, str(ana): 500}

def test_search_every_month(couple):
    client, alex, ana = couple
    expense(client, name="Mercadona", date="2025-03-02", tags=["weekly"], person_id=ana)
    expense(client, name="Lidl", amount="120", date="2026-05-02")
    expense(client, name="Café Nómada", category="Food", amount="3.5", tags=["coffee"], person_id=ana)
    q = lambda **p: [t["name"] for t in client.get("/transactions/search", params=p).json()]
    assert q(text=["merca"]) == ["Mercadona"]
    assert q(tags=["#coffee"]) == ["Café Nómada"]
    assert q(min="100") == ["Lidl"]
    assert q(person=str(ana)) == ["Café Nómada", "Mercadona"]
    assert q(person="shared") == ["Lidl"]
    assert q(text=["ana"]) == ["Café Nómada", "Mercadona"]
    assert q(categories=["Food"]) == ["Café Nómada"]

def test_payee_memory(couple):
    client, alex, ana = couple
    for _ in range(3):
        expense(client, name="Mercadona", person_id=ana, tags=["weekly"], amount="40")
    expense(client, name="Mercadona", amount="20")
    s = client.get("/transactions/names/search", params={"q": "mer"}).json()[0]
    assert s["name"] == "Mercadona" and s["person_id"] == ana and s["tags"] == ["weekly"] and s["amount"] == "35.00"

# ---------- import ----------
def test_import_matches_skips_and_learns(couple):
    client, alex, ana = couple
    typed = expense(client, name="Mercadona", amount="54.20", date="2026-10-20", person_id=ana)
    expense(client, name="Bar Pinotxo", category="Food", amount="12.00", date="2026-10-21")
    client.post("/rules", json={"match": "netflix", "category": "Entertainment", "person_id": None})
    rows = [
        {"date": "2026-10-21", "name": "MERCADONA 4521 BCN", "amount": "-54.20"},
        {"date": "2026-10-21", "name": "TPV LA BOQUERIA", "amount": "12.00"},
        {"date": "2026-10-22", "name": "NETFLIX.COM", "amount": "13.99"},
        {"date": "2026-10-23", "name": "UNKNOWN SHOP", "amount": "8.00"},
    ]
    p = client.post("/import/preview", json=rows).json()
    assert p["counts"] == {"new": 2, "matched": 1, "possible": 1, "skipped": 0}
    assert p["rows"][0]["match"]["id"] == typed["id"]
    assert p["rows"][2]["category"] == "Entertainment" and p["rows"][2]["shared"] is True

    commit = [{**rows[i], **{k: p["rows"][i][k] for k in ("import_ref", "category", "person_id", "shared")},
               "action": {"matched": "match", "possible": "skip", "new": "add"}[p["rows"][i]["status"]],
               "match_id": (p["rows"][i]["match"] or {}).get("id")} for i in range(4)]
    assert client.post("/import/commit", json={"rows": commit}).json() == {"added": 2, "matched": 1}
    kept = client.get(f"/transactions/id/{typed['id']}").json()[0]
    assert kept["name"] == "Mercadona" and kept["source"] == {"name": "MERCADONA 4521 BCN", "date": "2026-10-21"}

    again = client.post("/import/preview", json=rows).json()
    assert again["counts"]["skipped"] == 3

    # Fixing an imported row teaches a rule
    shop = next(t for t in client.get("/transactions").json() if t["name"] == "UNKNOWN SHOP")
    client.put(f"/transactions/{shop['id']}", json={"category": "Shopping"})
    learned = [r for r in client.get("/rules").json() if r["learned"]]
    assert learned and learned[0]["match"] == "UNKNOWN SHOP" and learned[0]["category"] == "Shopping"

# ---------- categories, tags, people ----------
def test_delete_category_moves_transactions(couple):
    client, *_ = couple
    expense(client, category="Snacks")
    assert client.delete("/categories/Snacks").status_code == 400
    assert client.delete("/categories/Snacks", params={"move_to": "Food"}).status_code == 200
    assert {t["category"] for t in client.get("/transactions").json()} == {"Food"}

def test_rename_tag_into_existing_merges(couple):
    client, *_ = couple
    expense(client, tags=["cafe", "coffee"])
    client.put("/tags/cafe", json={"name": "coffee"})
    assert client.get("/transactions").json()[0]["tags"] == ["coffee"]
    assert "cafe" not in client.get("/tags").json()

def test_remove_person_moves_their_part(couple):
    client, alex, ana = couple
    carol = client.post("/people", json={"name": "Carol"}).json()["id"]
    shared = expense(client, amount="30", paid_by=carol)
    own = expense(client, person_id=carol)
    client.request("DELETE", f"/people/{carol}", json={"move_to": ana})
    t = {x["id"]: x for x in client.get("/transactions").json()}
    assert t[own["id"]]["person_id"] == ana
    assert t[shared["id"]]["paid_by"] == ana and sum(t[shared["id"]]["shares"].values()) == 3000

def test_tag_into_person(couple):
    client, alex, ana = couple
    expense(client, tags=["ana", "weekly"])
    assert client.get("/people/from-tag/preview", params={"tag": "#ana"}).json()["count"] == 1
    client.post(f"/people/{ana}/from-tag", json={"tag": "ana"})
    t = client.get("/transactions").json()[0]
    assert t["person_id"] == ana and t["tags"] == ["weekly"]

def test_tag_into_person_includes_recurring(couple):
    client, alex, ana = couple
    rule(client, tags=["ana"], startDate=TODAY)
    client.post(f"/people/{ana}/from-tag", json={"tag": "ana"})
    r = client.get("/recurring").json()[0]
    assert r["person_id"] == ana and r["shares"] is None and r["tags"] == []

def test_tags_into_people_together(couple):
    client, alex, ana = couple
    expense(client, tags=["ana"])
    expense(client, tags=["Alex"])
    both = expense(client, tags=["ana", "Alex", "weekly"])
    rule(client, tags=["Alex"], startDate=TODAY)
    body = {"tags": {"ana": ana, "#Alex": alex}}
    preview = client.post("/people/from-tags/preview", json=body).json()
    assert preview == {"counts": {str(ana): 1, str(alex): 2}, "shared": 1}
    # The preview changes nothing
    assert all(t["person_id"] is None for t in client.get("/transactions").json())
    assert client.post("/people/from-tags", json=body).json()["counts"] == preview["counts"]
    t = {x["id"]: x for x in client.get("/transactions").json()}
    # With both people's tags it stays shared, without them
    assert t[both["id"]]["person_id"] is None and t[both["id"]]["shares"] == both["shares"] and t[both["id"]]["tags"] == ["weekly"]
    assert client.get("/recurring").json()[0]["person_id"] == alex
    assert client.post("/people/from-tags", json={"tags": {"ana": 999}}).status_code == 404

# ---------- settings, budgets, goals, backups ----------
def test_config_validates(client):
    assert client.put("/config", json={"savings_target": 120}).status_code == 400
    assert client.put("/config", json={"week_start": "tue"}).status_code == 400
    c = client.put("/config", json={"savings_target": 20, "saved_views": [{"name": "Holidays", "query": "#holiday"}]}).json()
    assert c["savings_target"] == 20 and c["saved_views"] == [{"name": "Holidays", "query": "#holiday"}]

def test_budgets_and_goals(client):
    b = client.put("/budgets", json=[{"category": "Groceries", "amount": "500", "kind": "flexible"}]).json()
    assert b[0]["category"] == "Groceries"
    g = client.post("/goals", json={"name": "Japan", "target": "4000", "due": "2027-06-01"}).json()
    g = client.post(f"/goals/{g['id']}/entries", json={"date": TODAY, "amount": "300"}).json()
    assert g["saved"] == "300.00"

def test_backup_and_restore(couple):
    client, *_ = couple
    expense(client, name="Before")
    backup = client.post("/backups").json()
    expense(client, name="After")
    r = client.post(f"/backups/{backup['name']}/restore").json()
    assert r["previous"].startswith("before-restore-")
    assert [t["name"] for t in client.get("/transactions").json()] == ["Before"]
    assert client.post("/backups/../wally.db/restore").status_code in (400, 404)

# ---------- upgrade from 1.x ----------
def test_upgrade_from_v1(make_client, tmp_path):
    client = make_client(FIXTURES / "v1.db")
    assert (tmp_path / "backups" / f"pre-2.0-{TODAY}.db").exists()
    conn = sqlite3.connect(tmp_path / "wally.db")
    assert conn.execute("SELECT value FROM appconfig WHERE key='SCHEMA_VERSION'").fetchone() == ("1",)
    conn.close()

    status = client.get("/auth/status").json()
    assert status["signin"] and status["household_password"] and status["onboarded"] and status["people"] == []

    # Before anyone is added, the household password still signs in
    assert client.post("/login", json={"password": "household"}).status_code == 200
    txs = client.get("/transactions").json()
    netflix = sorted(t["date"] for t in txs if t["name"] == "Netflix")
    assert netflix[0] == "2026-01-31" and netflix[-1] == "2026-09-30" and len(netflix) == 9
    assert {t["name"] for t in txs} >= {"Coffee 0", "Salary", "Mercadona"}
    r = client.get("/recurring").json()[0]
    assert r["interval"] == 1 and r["last_run"] == TODAY and r["endDate"] == "2027-12-31"

    # People added later sign in with the household password, then choose their own
    alex = client.post("/people", json={"name": "Alex"}).json()["id"]
    client.cookies.clear()
    r = client.post("/login", json={"person_id": alex, "password": "household"})
    assert r.json()["must_change_password"] is True

    # Old API keys keep working
    assert client.get("/api-keys").json()[0]["prefix"] == ""

    # And so do the 1.x routes scripts may call
    for route in ("past-3-months", "past-6-months", "past-12-months", "year-to-date", "to-date"):
        assert client.get(f"/transactions/{route}").status_code == 200
    recent = client.get("/transactions/past-3-months").json()
    assert {t["name"] for t in recent} >= {"Coffee 0", "Salary", "Mercadona"}
    assert [t["date"] for t in recent if t["name"] == "Netflix"] == ["2026-09-30", "2026-08-31"]
    assert len(client.get("/transactions/to-date").json()) == len(client.get("/transactions").json())

def test_failed_upgrade_restores_and_opens_read_only(make_client, tmp_path, monkeypatch):
    def broken(conn, today):
        conn.exec_driver_sql("ALTER TABLE \"transaction\" ADD COLUMN person_id INTEGER")
        raise RuntimeError("disk full")
    monkeypatch.setitem(database.STEPS, 1, broken)
    client = make_client(FIXTURES / "v1.db")
    status = client.get("/auth/status").json()
    assert "disk full" in status["read_only"]
    conn = sqlite3.connect(tmp_path / "wally.db")
    columns = [r[1] for r in conn.execute('PRAGMA table_info("transaction")')]
    conn.close()
    assert "person_id" not in columns
    assert client.post("/login", json={"password": "household"}).status_code == 503
    assert client.get("/transactions").status_code == 503

def test_demo_generates(tmp_path, monkeypatch):
    monkeypatch.setenv("WALLY_TODAY", TODAY)
    database.configure(tmp_path)
    from api.demo import generate_demo
    generate_demo()
    with database.Session(database.engine) as db:
        from sqlmodel import select, func
        from api.models.transactions import Transaction
        count = db.exec(select(func.count()).select_from(Transaction)).one()
    assert count > 500

def test_ledger_is_compact_and_complete(couple):
    client, alex, ana = couple
    t = expense(client, amount="10.01", paid_by=alex, tags=["coffee"], note="with Ana")
    own = expense(client, amount="2.50", person_id=ana)
    ledger = client.get("/ledger").json()
    rows = {r[0]: dict(zip(ledger["columns"], r)) for r in ledger["rows"]}
    shared = rows[t["id"].replace("-", "")]
    assert shared["cents"] == 1001 and shared["type"] == "e" and shared["shares"] == {str(alex): 501, str(ana): 500}
    assert shared["paid_by"] == alex and shared["tags"] == ["coffee"] and shared["note"] == "with Ana" and shared["created_by"] == alex
    # Trailing empty values are left out
    assert len(next(r for r in ledger["rows"] if r[0] == own["id"].replace("-", ""))) == 9

def test_restore_keeps_id_and_created_date(couple):
    client, alex, ana = couple
    t = expense(client, note="kept")
    client.delete(f"/transactions/{t['id']}")
    back = client.post("/transactions/restore", json=[{**t}]).json()[0]
    assert back["id"] == t["id"] and back["created_date"] == t["created_date"] and back["note"] == "kept"

def test_rename_category_carries_budget_and_rules(client):
    client.put("/budgets", json=[{"category": "Food", "amount": "200"}])
    client.post("/rules", json={"match": "glovo", "category": "Food"})
    client.put("/categories/Food", json={"name": "Eating out"})
    assert client.get("/budgets").json()[0]["category"] == "Eating out"
    assert client.get("/rules").json()[0]["category"] == "Eating out"

def test_reimporting_own_export_skips_matched_rows(couple):
    client, alex, ana = couple
    expense(client, name="Mercadona", amount="54.20", date="2026-10-20")
    bank = [{"date": "2026-10-21", "name": "MERCADONA 4521", "amount": "54.20"}]
    p = client.post("/import/preview", json=bank).json()["rows"][0]
    client.post("/import/commit", json={"rows": [{**bank[0], "import_ref": p["import_ref"], "action": "match", "match_id": p["match"]["id"]}]})
    # Wally's export says what Wally kept: the typed name and date
    again = client.post("/import/preview", json=[{"date": "2026-10-20", "name": "Mercadona", "amount": "54.20", "category": "Groceries"}]).json()
    assert again["counts"]["skipped"] == 1
