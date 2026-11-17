"""Checks on the web app's files that need no browser."""
import base64
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def test_the_policy_allows_exactly_the_inline_scripts_of_the_page():
    """Change an inline script in index.html and its hash in nginx.conf must change with it, or the
    browser refuses to run it and Wally opens on a blank page."""
    html = (ROOT / "web/index.html").read_text()
    scripts = re.findall(r"<script>(.*?)</script>", html, re.S)
    hashes = {"'sha256-" + base64.b64encode(hashlib.sha256(s.encode()).digest()).decode() + "'" for s in scripts}
    policy = re.search(r'^    add_header Content-Security-Policy "([^"]+)" always;', (ROOT / "nginx.conf").read_text(), re.M).group(1)
    script_src = re.search(r"script-src ([^;]+)", policy).group(1).split()
    assert hashes == {x for x in script_src if x.startswith("'sha256-")}
    assert "'unsafe-inline'" not in script_src

def test_no_inline_event_handlers():
    """The policy blocks onclick="..." and the like: listeners are added in the scripts"""
    found = []
    for f in list((ROOT / "web/js").rglob("*.js")) + [ROOT / "web/index.html"]:
        if "vendors" in f.parts:
            continue
        for n, line in enumerate(f.read_text().splitlines(), 1):
            if re.search(r"""[\s"'<]on[a-z]+=["']""", line):
                found.append(f"{f.relative_to(ROOT)}:{n}")
    assert not found, found
