"""The household's Emergency Kit: a recovery key of 48 letters and digits, as js/vault/crypto.js
makes it (29 random bytes and a check byte, Crockford base32). Kits made before 2.0 shipped hold
52 (31 random bytes and a check byte); those still work.

With encryption on, the browser makes it and the server keeps only a hash of a login key made from
it (models/vault.py). Without encryption, the server makes it here and keeps a hash of the key."""
import hashlib
import secrets

ABC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

def _base32(raw: bytes, chars: int) -> str:
    bits = "".join(f"{b:08b}" for b in raw).ljust(chars * 5, "0")
    return "".join(ABC[int(bits[i * 5:i * 5 + 5], 2)] for i in range(chars))

# Characters in the key: random bytes before the check byte
SIZES = {48: 29, 52: 31}

def new_key() -> str:
    body = secrets.token_bytes(29)
    key = _base32(body + hashlib.sha256(body).digest()[:1], 48)
    return "-".join(key[i:i + 4] for i in range(0, 48, 4))

def normalize(text: str) -> str | None:
    """The key as stored, from the key as typed (any case, with or without dashes, O for 0 and
    I or L for 1), or None when it was mistyped."""
    s = "".join(c for c in (text or "").upper() if c not in " -_.\r\n\t").replace("O", "0").replace("I", "1").replace("L", "1")
    n = SIZES.get(len(s))
    if not n or any(c not in ABC for c in s):
        return None
    bits = "".join(f"{ABC.index(c):05b}" for c in s)
    if "1" in bits[(n + 1) * 8:]:
        return None
    raw = bytes(int(bits[i * 8:i * 8 + 8], 2) for i in range(n + 1))
    return s if raw[n] == hashlib.sha256(raw[:n]).digest()[0] else None
