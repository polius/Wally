"""Turn sign-in off, for whoever runs the server, when the household forgot the password and lost
its Emergency Kit too. Open Wally afterwards and turn sign-in on again, with a new password.

    docker exec wally python3 -m api.signin_off

Refused while the household is encrypted: then nobody can open the data without the password or
the kit, not even whoever runs the server. That is the point of encrypting.
"""
import sys

from sqlmodel import Session

from . import database
from .services import vault as records

def main() -> int:
    database.import_models()
    with Session(database.engine) as db:
        if records.vault_id(db) or records.required():
            print("This household is encrypted: only the password or the Emergency Kit can open it. Nothing changed.")
            return 1
        from .routers.auth import flag
        from .routers.me import turn_signin_off
        if not flag(db, "LOGIN_PAGE"):
            print("Sign-in is already off.")
            return 0
        turn_signin_off(db)
        db.commit()
    print("Sign-in is off: anyone who can reach Wally can open it now. Open Wally and turn sign-in on again in Settings › Sign-in, with a new password.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
