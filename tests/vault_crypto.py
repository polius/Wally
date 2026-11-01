"""The browser's encryption (web/js/vault/crypto.js), written again in Python for the tests.

Two independent implementations that agree are the check: the tests drive the server with this
one, and open what real browsers stored with it. Needs argon2-cffi and cryptography (test only).
"""
import base64
import hashlib
import hmac
import json
import os
import unicodedata
import uuid

from argon2.low_level import Type, hash_secret_raw
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

ABC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

def b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()

def unb64(s: str) -> bytes:
    return base64.b64decode(s)

def hkdf(ikm: bytes, info: str, length: int = 32) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=b"", info=info.encode()).derive(ikm)

def new_salt() -> str:
    return b64(os.urandom(16))

def from_password(password: str, salt: str) -> tuple[str, bytes]:
    """(login key as hex, unlock key bytes)"""
    master = hash_secret_raw(unicodedata.normalize("NFC", password).encode(), unb64(salt), time_cost=3, memory_cost=65536, parallelism=1, hash_len=32, type=Type.ID)
    return hkdf(master, "wally login v1").hex(), hkdf(master, "wally unlock v1")

def lock(key: bytes, secret: bytes, vault_id: str) -> str:
    iv = os.urandom(12)
    return b64(iv + AESGCM(key).encrypt(iv, secret, f"wally wrap {vault_id}".encode()))

def unlock(key: bytes, wrap: str, vault_id: str) -> bytes:
    raw = unb64(wrap)
    return AESGCM(key).decrypt(raw[:12], raw[12:], f"wally wrap {vault_id}".encode())

class Household:
    def __init__(self, secret: bytes):
        self.record = hkdf(secret, "wally record key v1")
        self.idkey = hkdf(secret, "wally id key v1")

    def id_for(self, text: str) -> str:
        return hmac.new(self.idkey, text.encode(), hashlib.sha256).digest()[:16].hex()

    def seal(self, rid: str, version: int, obj: dict) -> str:
        body = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode()
        size = max(64, -(-len(body) // 64) * 64)
        padded = body + b" " * (size - len(body))
        iv = os.urandom(12)
        return b64(iv + AESGCM(self.record).encrypt(iv, padded, f"{rid}.{version}".encode()))

    def open(self, rid: str, version: int, ct: str) -> dict:
        raw = unb64(ct)
        plain = AESGCM(self.record).decrypt(raw[:12], raw[12:], f"{rid}.{version}".encode())
        assert len(plain) % 64 == 0, "records are padded to 64 bytes"
        return json.loads(plain.decode())

    def occurrence_id(self, rule_id: str, on: str) -> str:
        return str(uuid.UUID(self.id_for(f"occurrence|{rule_id}|{on}")))

def _base32(raw: bytes, chars: int) -> str:
    bits = "".join(f"{b:08b}" for b in raw).ljust(chars * 5, "0")
    return "".join(ABC[int(bits[i * 5:i * 5 + 5], 2)] for i in range(chars))

def _unbase32(text: str, nbits: int) -> tuple[bytes, str]:
    bits = "".join(f"{ABC.index(c):05b}" for c in text)
    out = bytes(int(bits[i * 8:i * 8 + 8], 2) for i in range(nbits // 8))
    return out, bits[len(out) * 8:nbits]

def _clean(text: str) -> str:
    return "".join(c for c in text.upper() if c not in " -_.\n").replace("O", "0").replace("I", "1").replace("L", "1")

def new_recovery_key() -> str:
    body = os.urandom(31)
    key = _base32(body + hashlib.sha256(body).digest()[:1], 52)
    return "-".join(key[i:i + 4] for i in range(0, 52, 4))

def parse_recovery_key(text: str) -> bytes:
    raw, _ = _unbase32(_clean(text), 256)
    assert raw[31] == hashlib.sha256(raw[:31]).digest()[0], "recovery key check byte"
    return raw

def from_recovery_key(raw: bytes) -> tuple[str, bytes]:
    return hkdf(raw, "wally recovery login v1").hex(), hkdf(raw, "wally recovery unlock v1")

def new_code() -> str:
    body = os.urandom(12)
    bits = "".join(f"{b:08b}" for b in body) + f"{hashlib.sha256(body).digest()[0] >> 4:04b}"
    code = "".join(ABC[int(bits[i * 5:i * 5 + 5], 2)] for i in range(20))
    return "-".join(code[i:i + 5] for i in range(0, 20, 5))

def parse_code(text: str) -> bytes:
    raw, rest = _unbase32(_clean(text), 100)
    assert int(rest, 2) == hashlib.sha256(raw).digest()[0] >> 4, "code check bits"
    return raw

def from_code(raw: bytes) -> tuple[str, bytes]:
    return hkdf(raw, "wally code login v1").hex(), hkdf(raw, "wally code unlock v1")

def record_id(item: dict, house: Household) -> str:
    """The record id the browser gives an item, as js/vault/session.js does when turning encryption on."""
    if item["k"] in ("tx", "rule"):
        return item["id"].replace("-", "").lower()
    if item["k"] in ("cat", "tag"):
        return house.id_for(f"{item['k']}|{item['name']}")
    if item["k"] == "irule":
        rid = house.id_for(f"irule|{item['id']}")
        item["id"] = rid
        return rid
    raise ValueError(item["k"])

def open_database(path, password: str, person_id: int) -> tuple[Household, list[dict]]:
    """Everything an encrypted wally.db holds, opened with one person's password, as a check
    from outside the browser."""
    import sqlite3
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        vault_id = conn.execute("SELECT value FROM appconfig WHERE key='VAULT_ID'").fetchone()[0]
        salt = conn.execute("SELECT salt FROM kdf WHERE person_id=?", (person_id,)).fetchone()[0]
        wrap = conn.execute("SELECT wrap FROM vaultkey WHERE person_id=?", (person_id,)).fetchone()[0]
        _, unlock_key = from_password(password, salt)
        house = Household(unlock(unlock_key, wrap, vault_id))
        items = [house.open(rid, v, b64(ct)) for rid, v, ct in conn.execute("SELECT id, version, ct FROM record WHERE deleted = 0")]
        return house, items
    finally:
        conn.close()
