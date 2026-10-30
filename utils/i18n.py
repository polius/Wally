"""Translations for the web app.

English text is the key: t("Spent so far") looks up "Spent so far" in web/locales/<lang>.json and falls
back to English. Plurals, tn(n, "{n} day", "{n} days"), are stored under the singular text as an object
with the language's plural forms: {"one": "...", "other": "..."} (plus "few", "many"... where the
language has them, as Intl.PluralRules names them).

    python utils/i18n.py --list            every string the app shows
    python utils/i18n.py --check           fail if any language misses one (CI runs this)
    python utils/i18n.py --missing es      the strings Spanish still needs, as JSON
    python utils/i18n.py --prune           drop strings the app no longer uses
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
LOCALES = WEB / "locales"
LANGUAGES = ["es", "ca", "fr", "de", "it", "pt", "ru", "zh", "ja", "ko", "hi", "ar"]

STRING = r'"((?:[^"\\\n]|\\.)*)"|\'((?:[^\'\\\n]|\\.)*)\''
T_CALL = re.compile(r'(?<![\w.$])t\(\s*(?:' + STRING + r')\s*[,)]')
# t(flag ? "one text" : "another"): both texts are keys
T_TERNARY = re.compile(r'(?<![\w.$])t\(\s*[^"\'()]{1,80}?\?\s*(?:' + STRING + r')\s*:\s*(?:' + STRING + r')')
TN_CALL = re.compile(r'(?<![\w.$])tn\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*(?:' + STRING + r')\s*,\s*(?:' + STRING + r')')

def _unescape(raw: str) -> str:
    return json.loads('"' + raw.replace('"', '\\"').replace("\\'", "'") + '"')

def extract() -> tuple[set[str], dict[str, str]]:
    """(plain strings, plurals as {singular: plural})"""
    plain, plural = set(), {}
    for path in sorted(WEB.glob("js/**/*.js")):
        if "vendors" in path.parts:
            continue
        source = path.read_text(encoding="utf-8")
        for m in TN_CALL.finditer(source):
            one = _unescape(m.group(1) if m.group(1) is not None else m.group(2))
            other = _unescape(m.group(3) if m.group(3) is not None else m.group(4))
            plural[one] = other
        for m in T_TERNARY.finditer(source):
            for a, b in ((1, 2), (3, 4)):
                plain.add(_unescape(m.group(a) if m.group(a) is not None else m.group(b)))
        for m in T_CALL.finditer(source):
            plain.add(_unescape(m.group(1) if m.group(1) is not None else m.group(2)))
    return plain - set(plural), plural

def load(lang: str) -> dict:
    path = LOCALES / f"{lang}.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    # Files from Wally 1.x were nested by page; they hold nothing 2.0 uses
    return data if all(isinstance(v, (str, dict)) and (isinstance(v, str) or "other" in v) for v in data.values()) else {}

def missing(lang: str) -> dict:
    plain, plural = extract()
    have = load(lang)
    out = {s: "" for s in sorted(plain) if not isinstance(have.get(s), str) or not have.get(s)}
    for one, other in sorted(plural.items()):
        entry = have.get(one)
        if not isinstance(entry, dict) or not entry.get("other"):
            out[one] = {"one": one, "other": other}
    return out

def main(args: list[str]) -> int:
    if not args or args[0] == "--list":
        plain, plural = extract()
        print(json.dumps({"strings": sorted(plain), "plurals": plural}, ensure_ascii=False, indent=1))
        return 0
    if args[0] == "--missing":
        print(json.dumps(missing(args[1]), ensure_ascii=False, indent=1))
        return 0
    if args[0] == "--check":
        plain, plural = extract()
        failed = False
        for lang in LANGUAGES:
            gaps = missing(lang)
            if gaps:
                failed = True
                print(f"{lang}: {len(gaps)} missing, for example: {list(gaps)[:3]}")
        print(f"{len(plain)} strings and {len(plural)} plurals in {len(LANGUAGES)} languages: {'incomplete' if failed else 'complete'}")
        return 1 if failed else 0
    if args[0] == "--prune":
        plain, plural = extract()
        for lang in LANGUAGES:
            have = load(lang)
            kept = {k: v for k, v in have.items() if k in plain or k in plural}
            (LOCALES / f"{lang}.json").write_text(json.dumps(dict(sorted(kept.items())), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        return 0
    print(__doc__)
    return 2

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
