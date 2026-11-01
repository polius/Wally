"""The household's Emergency Kit: a recovery key of 52 letters and digits, as js/vault/crypto.js
makes it (31 random bytes and a check byte, Crockford base32).

With encryption on, the browser makes it and the server keeps only a hash of a login key made from
it (models/vault.py). Without encryption, the server makes it here and keeps a hash of the key."""
import hashlib
import secrets

ABC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

def _base32(raw: bytes, chars: int) -> str:
    bits = "".join(f"{b:08b}" for b in raw).ljust(chars * 5, "0")
    return "".join(ABC[int(bits[i * 5:i * 5 + 5], 2)] for i in range(chars))

def new_key() -> str:
    body = secrets.token_bytes(31)
    key = _base32(body + hashlib.sha256(body).digest()[:1], 52)
    return "-".join(key[i:i + 4] for i in range(0, 52, 4))

def normalize(text: str) -> str | None:
    """The key as stored, from the key as typed (any case, with or without dashes, O for 0 and
    I or L for 1), or None when it was mistyped."""
    s = "".join(c for c in (text or "").upper() if c not in " -_.\r\n\t").replace("O", "0").replace("I", "1").replace("L", "1")
    if len(s) != 52 or any(c not in ABC for c in s):
        return None
    bits = "".join(f"{ABC.index(c):05b}" for c in s)
    if "1" in bits[256:]:
        return None
    raw = bytes(int(bits[i * 8:i * 8 + 8], 2) for i in range(32))
    return s if raw[31] == hashlib.sha256(raw[:31]).digest()[0] else None
