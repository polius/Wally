"""The upgrade from every Wally 1.x release (tests/fixtures/v1.<n>.db, made by each release's own
image with utils/make_v1_fixtures.py), checked from outside the upgrade's own check.

Run with: pytest tests
"""
import hashlib
import json
import shutil
import sqlite3
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import database, upgrade
from tests.test_api import TODAY, make_client  # noqa: F401 (the fixture)

FIXTURES = Path(__file__).parent / "fixtures"
RELEASES = sorted(FIXTURES.glob("v1.*.db"), key=lambda p: [int(x) for x in p.stem[1:].split(".")]) + [FIXTURES / "v1.db"]
PASSWORD = "household-pass-1"

def read(path: Path) -> dict:
    """A 1.x database, read plainly: transactions and rules by id, as stored."""
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        tx = {r[0]: r[1:] for r in conn.execute('SELECT id, date, name, category, amount, type, tags, "recurringID", created_date FROM "transaction"')}
        rules = {r[0]: r[1:] for r in conn.execute('SELECT id, name, category, amount, type, "startDate", "endDate", frequency, tags FROM recurringtransaction')}
        cats = sorted(r[0] for r in conn.execute("SELECT name FROM category"))
        tags = sorted(r[0] for r in conn.execute("SELECT name FROM tag"))
        config = dict(conn.execute("SELECT key, value FROM appconfig"))
        return {"tx": tx, "rules": rules, "cats": cats, "tags": tags, "config": config}
    finally:
        conn.close()

def sign_in(client, config: dict, password: str = PASSWORD):
    if config.get("LOGIN_PAGE") in ("1", "True", "true") and config.get("LOGIN_PASSWORD"):
        assert client.post("/login", json={"password": password}).status_code == 200

@pytest.mark.parametrize("fixture", RELEASES, ids=lambda p: p.stem)
def test_every_1x_release_upgrades_and_keeps_everything(make_client, tmp_path, fixture):
    old = read(fixture)
    client = make_client(fixture)
    status = client.get("/auth/status").json()
    assert not status["read_only"], status["read_only"]
    new = read(tmp_path / "wally.db")
    # Every past transaction is there, exactly as it was; charges 1.x made for after today are not
    future = {i for i, r in old["tx"].items() if r[6] and r[0][:10] > TODAY}
    assert new["tx"] == {i: r for i, r in old["tx"].items() if i not in future}
    assert new["rules"] == old["rules"] and new["cats"] == old["cats"] and new["tags"] == old["tags"]
    for key, value in old["config"].items():
        assert new["config"][key] == value, key
    # The report says so, with figures anyone can check against 1.x
    report = json.loads((tmp_path / f"upgrade-report-{json.loads(new['config']['UPGRADE_REPORT'])['at'][:10]}.json").read_text())
    kept = [r for i, r in old["tx"].items() if i not in future]
    assert report["kept"]["transactions"] == len(kept) and len(report["removed"]) == len(future)
    assert Decimal(report["kept"]["expense"]) == sum(Decimal(str(r[3])) for r in kept if r[4] != "income")
    assert (tmp_path / "backups" / report["backup"]).exists()
    # The app reads it all, and shows the report once
    # The household password: this test's own, or the older hand-made fixture's
    sign_in(client, old["config"], "household" if fixture.name == "v1.db" else PASSWORD)
    assert client.get("/auth/status").json()["upgrade"]["kept"]["transactions"] == len(kept)
    assert len(client.get("/ledger").json()["rows"]) == len(kept)
    assert "Kept, and checked one by one" in client.get("/upgrade/report").text
    client.post("/upgrade/seen")
    assert client.get("/auth/status").json()["upgrade"] is None
    # Then once for each person: someone added later sees the welcome to 2.0 too, until they've seen it
    ana = client.post("/people", json={"name": "Ana"}).json()["id"]
    other = TestClient(client.app)
    if old["config"].get("LOGIN_PAGE") in ("1", "True", "true") and old["config"].get("LOGIN_PASSWORD"):
        other.post("/login", json={"person_id": ana, "password": "household" if fixture.name == "v1.db" else PASSWORD})
    else:
        other.headers["x-wally-person"] = str(ana)
    assert other.get("/auth/status").json()["upgrade"]["kept"]["transactions"] == len(kept)
    other.post("/upgrade/seen")
    assert other.get("/auth/status").json()["upgrade"] is None

def test_charges_taken_out_come_back_once_on_their_day(make_client, monkeypatch):
    from api.services.engine import run_all
    client = make_client(FIXTURES / "v1.16.db")
    with database.Session(database.engine) as db:
        assert run_all(db) == 0
    monkeypatch.setenv("WALLY_TODAY", "2026-11-16")
    with database.Session(database.engine) as db:
        assert run_all(db) == 1
        assert run_all(db) == 0
    conn = sqlite3.connect(database.DB_PATH)
    dates = [r[0] for r in conn.execute("SELECT date FROM \"transaction\" WHERE name='Netflix' ORDER BY date")]
    conn.close()
    assert dates[-2:] == ["2026-10-15", "2026-11-15"] and len(dates) == len(set(dates))

def test_a_messy_database_upgrades_and_says_what_was_odd(make_client, tmp_path):
    messy = tmp_path / "messy.db"
    shutil.copy(FIXTURES / "v1.16.db", messy)
    conn = sqlite3.connect(messy)
    conn.execute("INSERT INTO \"transaction\" (id, name, category, tags, amount, type, date, \"recurringID\", created_date) VALUES "
                 "('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Ghost shop', 'Ghost', 'null', '7.10', 'expense', '2026-10-10', '', '2026-10-10 10:00:00.000000')")
    conn.execute("INSERT INTO \"transaction\" (id, name, category, tags, amount, type, date, \"recurringID\", created_date) VALUES "
                 "('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '', 'Food', '[\"a\",\"a\"]', 0.005, 'expense', '2026-10-11', 'gone-rule', '2026-10-11T10:00:00')")
    conn.commit()
    conn.close()
    other = tmp_path / "other"
    other.mkdir()
    shutil.copy(messy, other / "wally.db")
    database.configure(other)
    database.create_db_and_tables()
    assert not database.STATE["read_only"], database.STATE["read_only"]
    report = database.STATE["upgrade"]
    kinds = {n["kind"]: n for n in report["notes"]}
    assert "Ghost" in kinds["categories"]["examples"] and kinds["decimals"]["count"] >= 2
    text = upgrade.text(report)
    assert "Ghost" in text and "more than two decimals" in text

def test_a_broken_upgrade_step_is_caught_and_nothing_is_kept(make_client, tmp_path, monkeypatch):
    """If a step ever lost a past transaction, the check would undo the whole upgrade."""
    original = database.STEPS[1]
    def losing(conn, today):
        original(conn, today)
        conn.exec_driver_sql("DELETE FROM \"transaction\" WHERE name = 'Mercadona'")
    monkeypatch.setitem(database.STEPS, 1, losing)
    client = make_client(FIXTURES / "v1.16.db")
    status = client.get("/auth/status").json()
    assert status["read_only"] and "transactions are missing" in status["read_only"]
    # The old database is back, as it was: same data, same tables, no 2.0 columns
    assert read(tmp_path / "wally.db") == read(FIXTURES / "v1.16.db")
    conn = sqlite3.connect(tmp_path / "wally.db")
    assert "person_id" not in {r[1] for r in conn.execute('PRAGMA table_info("transaction")')}
    conn.close()

def test_the_check_runs_on_a_copy_and_changes_nothing(tmp_path, capsys):
    target = tmp_path / "wally.db"
    shutil.copy(FIXTURES / "v1.5.db", target)
    before = hashlib.sha256(target.read_bytes()).hexdigest()
    assert upgrade.check(target) == 0
    out = capsys.readouterr().out
    assert "Kept, and checked one by one" in out and "Taken out:" in out and "Nothing was changed." in out
    assert hashlib.sha256(target.read_bytes()).hexdigest() == before
    assert sorted(p.name for p in tmp_path.iterdir()) == ["wally.db"]

def test_an_upgraded_household_can_turn_on_encryption(make_client, tmp_path):
    pytest.importorskip("cryptography")
    from tests.test_vault import turn_on, export
    client = make_client(FIXTURES / "v1.16.db")
    sign_in(client, read(FIXTURES / "v1.16.db")["config"])
    alex = client.post("/people", json={"name": "Alex"}).json()["id"]
    # As after the upgrade: everyone signs in as themselves with the same household password
    client.post("/logout")
    assert client.post("/login", json={"person_id": alex, "password": PASSWORD}).json() == {"ok": True, "code_needed": False}
    before = export()
    assert turn_on(client, alex, PASSWORD)["count"] == len(before)
