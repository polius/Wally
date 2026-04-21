import sqlite3
import os

db_path = os.path.join("data", "wally.db")

if not os.path.exists(db_path):
    print(f"ERROR: DB not found at {db_path}")
    print("Make sure you run this from the Wally project root.")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

cursor.execute("PRAGMA table_info(recurringtransaction)")
columns = [r[1] for r in cursor.fetchall()]
print(f"recurringtransaction columns: {columns}")

if "person" not in columns:
    print("\n>>> 'person' column MISSING — adding it now...")
    cursor.execute("ALTER TABLE recurringtransaction ADD COLUMN person TEXT NOT NULL DEFAULT ''")
    conn.commit()
    print(">>> Done. Column added successfully.")
else:
    print("\n>>> 'person' column EXISTS.")

    # Show a sample of current data
    cursor.execute("SELECT id, name, person FROM recurringtransaction LIMIT 5")
    rows = cursor.fetchall()
    if rows:
        print("\nSample rows (id, name, person):")
        for r in rows:
            print(f"  {r}")
    else:
        print("  (no rows yet)")

conn.close()
