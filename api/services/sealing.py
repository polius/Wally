"""The browser's record encryption (web/js/vault/crypto.js), for API keys on an encrypted household.

The server holds no key of its own. An API key made while Wally is encrypted carries a secret; the
browser that made it locked the household key under that secret. A call with the key opens the
household key for that call only (services/sealed_view.py), and nothing opened is kept.

    API key secret (32 random bytes, in the key) ──HKDF "wally api key v1"──▶ opens the household key
    household secret ──HKDF "wally record key v1"──▶ AES-256-GCM key for records
                     ──HKDF "wally id key v1"──────▶ HMAC key for ids that must be the same on every device
"""
import base64
import hashlib
import hmac
import json
import os
import re
import uuid

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

KEY = re.compile(r"^wly_([0-9a-f]{64})$")
BLOCK = 64

def hkdf(ikm: bytes, info: str, length: int = 32) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=b"", info=info.encode()).derive(ikm)

def key_secret(raw_key: str) -> bytes | None:
    """The 32 bytes in an API key made since 2.0, or None for an older key"""
    m = KEY.match(raw_key or "")
    return bytes.fromhex(m.group(1)) if m else None

def unlock(key: bytes, wrap: str, vault_id: str) -> bytes | None:
    """The secret locked in a wrap, or None when this key doesn't open it"""
    try:
        raw = base64.b64decode(wrap, validate=True)
        return AESGCM(key).decrypt(raw[:12], raw[12:], f"wally wrap {vault_id}".encode())
    except (InvalidTag, ValueError, TypeError):
        return None

def unlock_with_api_key(raw_key: str, wrap: str, vault_id: str) -> bytes | None:
    secret = key_secret(raw_key)
    return unlock(hkdf(secret, "wally api key v1"), wrap, vault_id) if secret else None

class Household:
    """The household's record keys, opened for one call"""
    def __init__(self, secret: bytes):
        self.record = AESGCM(hkdf(secret, "wally record key v1"))
        self.idkey = hkdf(secret, "wally id key v1")

    def id_for(self, text: str) -> str:
        return hmac.new(self.idkey, text.encode(), hashlib.sha256).digest()[:16].hex()

    def occurrence_id(self, rule_id: str, on: str) -> uuid.UUID:
        """A rule's charge on a date: the same id the browsers make, so two of them make one"""
        return uuid.UUID(self.id_for(f"occurrence|{rule_id}|{on}"))

    def seal(self, rid: str, version: int, obj: dict) -> str:
        body = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode()
        # Padded with spaces to 64 bytes, as the browser does, so sizes say little about what is inside
        size = max(BLOCK, -(-len(body) // BLOCK) * BLOCK)
        iv = os.urandom(12)
        return base64.b64encode(iv + self.record.encrypt(iv, body + b" " * (size - len(body)), f"{rid}.{version}".encode())).decode()

    def open(self, rid: str, version: int, ct: bytes) -> dict | None:
        """The record, or None when it doesn't open: changed by someone without the key"""
        try:
            return json.loads(self.record.decrypt(ct[:12], ct[12:], f"{rid}.{version}".encode()).decode())
        except (InvalidTag, ValueError):
            return None
