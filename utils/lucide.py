"""Builds the icon library a category can pick from, out of the lucide-static package (ISC license).

    npm pack lucide-static            # or download https://registry.npmjs.org/lucide-static/-/lucide-static-<v>.tgz
    tar xzf lucide-static-*.tgz
    python utils/lucide.py package    # writes web/icons/lucide.svg, lucide.json and LICENSE-lucide.txt

lucide.svg holds every icon as a <symbol>, read only when a picked icon or the picker needs it.
lucide.json holds each icon's name and the words Lucide's own site searches by, for the picker's search.
"""
import json
import re
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "web" / "icons"


def main(pkg: Path):
    version = json.loads((pkg / "package.json").read_text())["version"]
    sprite = (pkg / "sprite.svg").read_text()
    symbols = re.findall(r"<symbol\b.*?</symbol>", sprite, re.S)
    names = []
    small = []
    for s in symbols:
        name = re.search(r'id="([^"]+)"', s).group(1)
        names.append(name)
        s = re.sub(r">\s+<", "><", s)
        s = re.sub(r"\s*/>", "/>", s)
        small.append(s.strip())
    (OUT / "lucide.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg"><!-- Lucide {version}, ISC license: LICENSE-lucide.txt -->'
        + "".join(small) + "</svg>\n")
    tags = json.loads((pkg / "tags.json").read_text())
    # An icon's old names (music is now eighth-notes) are good words to find it by
    norm = lambda x: re.sub(r"\s+", " ", re.sub(r"\s*/>", "/>", x)).strip()
    by_body = {}
    for s in symbols:
        by_body.setdefault(norm(s[s.index(">") + 1:s.rindex("</symbol>")]), re.search(r'id="([^"]+)"', s).group(1))
    old = {}
    for f in sorted((pkg / "icons").glob("*.svg")):
        if f.stem in tags:
            continue
        svg = f.read_text()
        to = by_body.get(norm(svg[svg.index(">", svg.index("<svg")) + 1:svg.rindex("</svg>")]))
        if to:
            old.setdefault(to, []).append(f.stem.replace("-", " "))
    rows = [[n, " ".join(dict.fromkeys([t.lower() for t in tags.get(n, [])] + old.get(n, [])))] for n in names]
    (OUT / "lucide.json").write_text(json.dumps({"version": version, "icons": rows}, ensure_ascii=False, separators=(",", ":")) + "\n")
    (OUT / "LICENSE-lucide.txt").write_text((pkg / "LICENSE").read_text())
    print(f"Lucide {version}: {len(names)} icons, {sum(map(len, old.values()))} old names")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "package"))
