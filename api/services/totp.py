"""Two-step sign-in codes (TOTP, RFC 6238), built on the standard library."""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

STEP = 30
DIGITS = 6

def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")

def code_at(secret: str, counter: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10 ** DIGITS).zfill(DIGITS)

def match(secret: str, code: str, now: float | None = None) -> int | None:
    """The counter the code belongs to, allowing one step either side for clock drift, or None."""
    code = "".join(ch for ch in code if ch.isdigit())
    if len(code) != DIGITS:
        return None
    counter = int((now if now is not None else time.time()) // STEP)
    found = None
    for candidate in (counter - 1, counter, counter + 1):
        if hmac.compare_digest(code_at(secret, candidate), code):
            found = candidate
    return found

def otpauth_uri(secret: str, account: str) -> str:
    return f"otpauth://totp/{quote('Wally')}:{quote(account)}?secret={secret}&issuer=Wally&digits={DIGITS}&period={STEP}"

def new_recovery_codes(count: int = 10) -> list[str]:
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
    return ["".join(secrets.choice(alphabet) for _ in range(4)) + "-" + "".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(count)]

def hash_code(code: str) -> str:
    normal = "".join(ch for ch in code.lower() if ch.isalnum())
    return hashlib.sha256(normal.encode()).hexdigest()
