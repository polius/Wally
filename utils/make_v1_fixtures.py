"""Make a Wally 1.x database for every 1.x release, for the upgrade tests (tests/test_upgrade.py).

Each release's own published image (poliuscorp/wally:1.0 to 1.16) is started, the same household
is added through its own API, and its database is kept as tests/fixtures/v1.<n>.db. So each
fixture is exactly what that release wrote, with the library versions it shipped with.

    python utils/make_v1_fixtures.py [1.0 1.5 ...]      needs Docker and the network

The household has the awkward cases: tags, an income, a three-decimal amount, a name with
quotes and accents, a 29 February, a recurring rule that 1.x filled in up to its end date
(including charges after today), one that ended, a yearly one, a new category and tag, and,
from 1.10, another currency. The household password is set last.
"""
import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures"
RELEASES = ["1.0", "1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9", "1.10", "1.11", "1.12", "1.13", "1.14", "1.15", "1.16"]
PORT = 8960
PASSWORD = "household-pass-1"

TRANSACTIONS = [
    {"name": "Mercadona", "category": "Groceries", "tags": ["weekly"], "amount": 23.45, "type": "expense", "date": "2026-10-02"},
    {"name": "Café Nómada ☕", "category": "Food", "tags": [], "amount": 3.5, "type": "expense", "date": "2026-10-03"},
    {"name": "Salary", "category": "Income", "tags": [], "amount": 2450, "type": "income", "date": "2026-10-01"},
    {"name": "Three decimals", "category": "Shopping", "tags": [], "amount": "12.345", "type": "expense", "date": "2026-09-30"},
    {"name": "Kids clothes", "category": "Kids", "tags": ["holiday", "kids"], "amount": 40, "type": "expense", "date": "2026-08-20"},
    {"name": "L'Àvia \"Rosa\"", "category": "Food", "tags": ["holiday"], "amount": 61.2, "type": "expense", "date": "2024-02-29"},
    {"name": "Refund", "category": "Shopping", "tags": [], "amount": 9.99, "type": "income", "date": "2026-09-12"},
]
RULES = [
    # 1.x adds every charge up to the end date at once, so this one has charges after today
    {"name": "Netflix", "category": "Entertainment", "tags": [], "amount": 13.99, "type": "expense", "startDate": "2026-06-15", "endDate": "2027-03-15", "frequency": "monthly"},
    {"name": "Gym", "category": "Healthcare", "tags": ["sport"], "amount": 2, "type": "expense", "startDate": "2026-09-01", "endDate": "2026-09-05", "frequency": "daily"},
    {"name": "Insurance", "category": "Utilities", "tags": [], "amount": 384, "type": "expense", "startDate": "2025-01-31", "endDate": "2028-01-31", "frequency": "yearly"},
]

def call(method: str, path: str, body=None, ok=(200,)):
    req = urllib.request.Request(f"http://localhost:{PORT}/api{path}", method=method,
                                 data=None if body is None else json.dumps(body).encode(), headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        if e.code in ok:
            return e.code, e.read().decode()
        raise RuntimeError(f"{method} {path}: {e.code} {e.read().decode()[:300]}")

def build(release: str) -> Path:
    data = Path(tempfile.mkdtemp(prefix=f"wally-{release}-"))
    name = f"wally-fixture-{release.replace('.', '-')}"
    subprocess.run(["docker", "rm", "-f", name], capture_output=True)
    subprocess.run(["docker", "run", "-d", "--name", name, "-p", f"{PORT}:80", "-v", f"{data}:/wally/data", f"poliuscorp/wally:{release}"], check=True, capture_output=True)
    try:
        for _ in range(120):
            try:
                if call("GET", "/categories")[0] == 200:
                    break
            except Exception:
                time.sleep(0.5)
        else:
            raise RuntimeError(f"{release} did not start")
        call("POST", "/categories", {"name": "Kids"})
        call("POST", "/tags", {"name": "holiday"}, ok=(200, 400, 404, 405))
        for t in TRANSACTIONS:
            call("POST", "/transactions", t)
        for r in RULES:
            call("POST", "/recurring", r)
        call("PUT", "/currency/USD", ok=(200, 404, 405))
        call("PUT", "/currency/position/left", ok=(200, 404, 405, 422))
        call("PUT", "/language/es", ok=(200, 404, 405))
        call("POST", "/login/password", {"password": PASSWORD})
    finally:
        subprocess.run(["docker", "stop", name], capture_output=True)
        subprocess.run(["docker", "rm", "-f", name], capture_output=True)
    target = FIXTURES / f"v1.{release.split('.', 1)[1]}.db"
    shutil.copy(data / "wally.db", target)
    return target

if __name__ == "__main__":
    for release in sys.argv[1:] or RELEASES:
        print(release, "->", build(release).relative_to(ROOT))
