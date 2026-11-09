#!/usr/bin/env python3
"""Film the real app for the Wally film: stills, typing sequences and page scans.

Everything comes from a local demo (DEMO=true, so the data is the sample
household and nothing is kept), in the light theme, with the demo's
"Sample data" bar hidden. The output lands in app/ (git-ignored) and the film
loads it from /app/.

  docker run --rm -e DEMO=true -p 80:80 poliuscorp/wally    # or the repo's own build
  capture_app.py                    # every shot, from http://localhost
  capture_app.py --url http://localhost:8080

Shots (desktop 1440x900 at 2x, phone 390x844 at 3x)
  summary.png         the Summary on last month, the whole page (the film scrolls it)
  review.png          Month in review for last month, the whole page
  search/NN.png       typing searches into Transactions: a shop, a tag, a person, an amount
  rec.png, rec_spotify.png   Recurring, then Spotify picked (its price went up)
  home_all/_1/_2.png  the Summary for Everyone, then each person
  m_add/NN.png        the phone's Add sheet: the keypad, the name, a split, shared, a tag, Save
  split_*.png         a shared IKEA bill in the desktop Add sheet: evenly, by income, by hand
  m_summary.png       the phone's Summary, the whole page
  m_lang/<lang>.png   the phone's Summary in other languages
  shots.json          sizes, sequences, and where things sit on each still

The Add sequence saves one expense (the desktop split is never saved); the demo forgets it when it stops. The
language shots change the household's language and put it back to English.
"""
from __future__ import annotations

import argparse
import json
import os
from datetime import date

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "app")
DESK = {"width": 1440, "height": 900}
PHONE = {"width": 390, "height": 844}

_first = date.today().replace(day=1)
LAST = (_first.replace(year=_first.year - 1, month=12) if _first.month == 1
        else _first.replace(month=_first.month - 1)).strftime("%Y-%m")

# Signed in as the first person, light theme, everyone's money, sidebar collapsed, no demo bar, no caret blink
INIT = """
localStorage.setItem('wally.person', '1');
localStorage.setItem('wally.theme', 'light');
localStorage.setItem('wally.side', 'rail');
localStorage.setItem('wally.scope', %s);
document.addEventListener('DOMContentLoaded', () => {
  const s = document.createElement('style');
  s.textContent = '.w-banner{display:none!important} html{--banner-h:0px!important} *{caret-color:transparent!important}';
  document.head.appendChild(s);
});
"""

META: dict = {"last": LAST}


def ctx_for(b, viewport, scale, scope="all"):
    ctx = b.new_context(viewport=viewport, device_scale_factor=scale, color_scheme="light",
                        service_workers="block", locale="en-US")
    ctx.add_init_script(INIT % json.dumps(scope))
    return ctx


def settle(page, ms=500):
    page.wait_for_load_state("networkidle")
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(ms)


def shot(page, path, full=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    page.screenshot(path=path, full_page=full, animations="disabled", caret="hide")
    print("  ", os.path.relpath(path, HERE))


def boxes(page, sels):
    """Where things sit on the page, in CSS px of the full page."""
    return page.evaluate("""(sels) => { const o = {}; for (const [k, s] of Object.entries(sels)) {
        const n = document.querySelector(s); if (!n) continue;
        const r = n.getBoundingClientRect();
        o[k] = [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)];
      } return o; }""", sels)


def page_size(page):
    return page.evaluate("[document.documentElement.scrollWidth, document.documentElement.scrollHeight]")


def summary(b, base):
    ctx = ctx_for(b, DESK, 2)
    p = ctx.new_page()
    p.goto(f"{base}/?month={LAST}")
    settle(p, 800)
    shot(p, os.path.join(OUT, "summary.png"), full=True)
    META["summary"] = {"size": page_size(p), "box": boxes(p, {
        "hero": '.s-sec[data-w="hero"]', "big": "#s-big", "cats": '.s-sec[data-w="cats"]', "bar": ".s-stack",
        "recap": "#s-recapw a.s-recap", "people": '.s-sec[data-w="people"]', "kept": '.s-sec[data-w="kept"]',
        "title": "#s-title"})}
    META["summary"]["text"] = p.evaluate("""() => ({
        big: document.querySelector('#s-big')?.textContent.trim(),
        lines: document.querySelector('#s-lines')?.innerText.trim(),
        cats: [...document.querySelectorAll('#s-cats .s-row')].slice(0, 6).map((r) => ({
          name: r.querySelector('.s-nm > span')?.textContent, amount: r.querySelector('.s-am')?.firstChild?.textContent })),
        bar: [...document.querySelectorAll('.s-stack i')].map((i) => ({ k: i.dataset.k, flex: +i.style.flex.split(' ')[0] || +i.style.flexGrow, color: getComputedStyle(i).backgroundColor })),
      })""")
    # Month in review, opened from the recap card
    p.goto(f"{base}/review?m={LAST}")
    settle(p, 900)
    shot(p, os.path.join(OUT, "review.png"), full=True)
    META["review"] = {"size": page_size(p)}
    ctx.close()


def search(b, base):
    ctx = ctx_for(b, DESK, 2)
    p = ctx.new_page()
    p.goto(f"{base}/transactions?month={LAST}")
    settle(p, 700)
    seq = []
    shot(p, os.path.join(OUT, "search", "00.png")); seq.append({"q": ""})
    p.click("#tx-q")
    p.wait_for_timeout(250)
    k = 1
    # the first search is typed letter by letter; the others swap in whole
    for q, typed in (("apple", True), ("#holiday", False), ("@ana", False), (">50", False)):
        if typed:
            for i in range(1, len(q) + 1):
                p.fill("#tx-q", q[:i])
                p.wait_for_timeout(180)
                shot(p, os.path.join(OUT, "search", f"{k:02d}.png")); seq.append({"q": q[:i]}); k += 1
        else:
            p.fill("#tx-q", q)
            p.wait_for_timeout(300)
            shot(p, os.path.join(OUT, "search", f"{k:02d}.png")); seq.append({"q": q}); k += 1
    META["search"] = {"frames": seq, "box": boxes(p, {"q": "#tx-q", "list": "#tx-listp", "count": "#tx-count"})}
    ctx.close()


def recurring(b, base):
    ctx = ctx_for(b, DESK, 2)
    p = ctx.new_page()
    p.goto(f"{base}/recurring")
    settle(p, 700)
    shot(p, os.path.join(OUT, "rec.png"))
    row = p.locator(".rec-list .w-rrow", has_text="Spotify").first
    box_row = row.bounding_box()
    row.click()
    p.wait_for_timeout(500)
    shot(p, os.path.join(OUT, "rec_spotify.png"))
    META["rec"] = {"box": boxes(p, {"panel": "#rec-insp", "pcard": "#rec-insp .rec-pcard", "list": ".rec-list",
                                    "sum": ".rec-sum"}),
                   "spotify": [round(box_row["x"]), round(box_row["y"]), round(box_row["width"]), round(box_row["height"])]}
    ctx.close()


def household(b, base):
    META["home"] = {}
    for scope in ("all", "1", "2"):
        ctx = ctx_for(b, DESK, 2, scope)
        p = ctx.new_page()
        p.goto(f"{base}/?month={LAST}")
        settle(p, 800)
        shot(p, os.path.join(OUT, f"home_{scope}.png"))
        META["home"][scope] = {"box": boxes(p, {"switch": ".w-pswitch-b", "people": '.s-sec[data-w="people"]',
                                                "big": "#s-big"}),
                               "big": p.evaluate("document.querySelector('#s-big')?.textContent.trim()")}
        ctx.close()


def api(base, path, body=None, method="GET"):
    import urllib.request
    req = urllib.request.Request(f"{base}/api{path}", method=method,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={"X-Wally-Person": "1", "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req).read() or "null")


def prep_demo(base):
    """The film's shop is Apple, and no real supermarket's name is on screen. Read from the demo's own
    data: the busiest grocer's receipts go to the other grocers in turn, and the busiest shop in
    Shopping (IKEA aside: it's the household's shared bill) becomes Apple, so Apple has a real
    history to search and to remember. Names only: every amount, date and total stays as it was."""
    rows = sorted(api(base, "/transactions"), key=lambda t: (t["date"], str(t["id"])))
    def by_count(cat):
        n = {}
        for t in rows:
            if t["type"] == "expense" and t["category"] == cat and t["name"]:
                n[t["name"]] = n.get(t["name"], 0) + 1
        return sorted(n, key=lambda x: (-n[x], x))
    grocers, shops = by_count("Groceries"), [x for x in by_count("Shopping") if x != "IKEA"]
    top, rest, shop = grocers[0], grocers[1:], shops[0]
    k = 0
    for t in rows:
        if t["name"] == top:
            api(base, f"/transactions/{t['id']}", {"name": rest[k % len(rest)]}, "PUT"); k += 1
        elif t["name"] == shop:
            api(base, f"/transactions/{t['id']}", {"name": "Apple"}, "PUT")
    for r in api(base, "/rules"):
        if r["match"] == top.upper():
            api(base, f"/rules/{r['id']}", {"match": rest[0].upper(), "category": r["category"],
                                            "person_id": r["person_id"], "set_person": r["set_person"]}, "PUT")
    print(f"   demo: the busiest grocer's {k} receipts -> the other grocers; the busiest shop -> Apple")


def phone_add(b, base):
    ctx = ctx_for(b, PHONE, 3)
    p = ctx.new_page()
    p.goto(f"{base}/?add=1")
    settle(p, 900)
    seq, k = [], 0

    def snap(label):
        nonlocal k
        shot(p, os.path.join(OUT, "m_add", f"{k:02d}.png")); seq.append(label); k += 1

    snap("open")
    for key in ("1", "8", ".", "5", "0"):
        p.click(f'#add-keypad [data-k="{key}"]')
        p.wait_for_timeout(160)
        snap("key " + key)
    # a tap on the name: the keypad's Next would go on to the category
    p.click("#add-name")
    p.wait_for_timeout(400)
    snap("next")
    name = "Apple"
    for i in range(1, len(name) + 1):
        p.fill("#add-name", name[:i])
        p.wait_for_timeout(160)
        snap("name " + name[:i])
    p.locator("#add-name").blur()
    p.wait_for_timeout(400)
    snap("named")
    # what the app filled in from last time, for the film's "… from last time"
    memo = p.evaluate("""() => ({cat: document.querySelector('#add-catv')?.textContent.trim(),
        who: document.querySelector('#add-whorow [data-aw][aria-pressed="true"]')?.textContent.trim()})""")
    rows = {"cat": "#add-catrow", "parts": "#add-parts", "who": "#add-whorow", "split": "#add-split",
            "note": "#add-splitnote", "tags": "#add-tagrow", "go": "#add-go"}
    bx = {"named": boxes(p, rows)}
    # split the receipt: a cable, Shopping 12.10, and the rest is an app, Entertainment
    p.click("#add-catrow")
    p.wait_for_timeout(450)
    p.click("[data-psplit]")
    p.wait_for_timeout(400)
    p.fill('[data-pa="0"]', "12.10")
    p.select_option('[data-pc="1"]', "Entertainment")
    p.locator('[data-pa="0"]').blur()
    p.wait_for_timeout(400)
    snap("split"); bx["split"] = boxes(p, rows)
    # share it: half each
    p.click('[data-aw="shared"]')
    p.wait_for_timeout(450)
    snap("shared"); bx["shared"] = boxes(p, rows)
    # tag the trip, letter by letter; a space makes the tag
    tag = "menorca"
    for i in range(1, len(tag) + 1):
        p.fill("#add-tag", tag[:i])
        p.wait_for_timeout(120)
        snap("tag " + tag[:i])
    p.fill("#add-tag", tag + " ")
    p.locator("#add-tag").blur()
    p.wait_for_timeout(400)
    snap("tagged"); bx["tagged"] = boxes(p, rows)
    p.click("#add-go")
    p.wait_for_timeout(800)
    snap("saved")
    META["m_add"] = {"frames": seq, "box": bx, "memo": memo}
    ctx.close()


def household_split(b, base):
    """A shared IKEA bill in the desktop Add sheet: split evenly, by income, then by hand (Custom)."""
    ctx = ctx_for(b, DESK, 2, "2")
    p = ctx.new_page()
    p.goto(f"{base}/?month={LAST}")
    settle(p, 800)
    p.keyboard.press("n")
    p.wait_for_timeout(700)
    p.fill("#add-amt", "640")
    p.fill("#add-name", "IKEA")
    p.locator("#add-name").blur()
    p.wait_for_timeout(400)
    p.click('[data-aw="shared"]')
    p.wait_for_timeout(450)
    rows = {"sheet": "#add-form", "who": "#add-whorow", "split": "#add-split", "sm": "#add-smsel",
            "note": "#add-splitnote", "cust": "#add-custrows"}
    out = {}
    shot(p, os.path.join(OUT, "split_even.png")); out["even"] = boxes(p, rows)
    p.select_option("#add-smsel", "income")
    p.wait_for_timeout(450)
    shot(p, os.path.join(OUT, "split_income.png")); out["income"] = boxes(p, rows)
    p.select_option("#add-smsel", "custom")
    p.wait_for_timeout(400)
    p.fill("#add-split-a", "420")
    p.locator("#add-split-a").blur()
    p.wait_for_timeout(450)
    shot(p, os.path.join(OUT, "split_hand.png")); out["hand"] = boxes(p, rows)
    out["text"] = p.evaluate("[...document.querySelectorAll('#add-custrows .w-gr')].map(r => r.innerText.replace(/\\s+/g, ' '))")
    META["split"] = out
    ctx.close()


def phone_summary(b, base):
    import urllib.request
    ctx = ctx_for(b, PHONE, 3)
    p = ctx.new_page()
    p.goto(f"{base}/?month={LAST}")
    settle(p, 900)
    shot(p, os.path.join(OUT, "m_summary.png"), full=True)
    META["m_summary"] = {"size": page_size(p)}
    ctx.close()

    def set_lang(lang):
        req = urllib.request.Request(f"{base}/api/language/{lang}", method="PUT", headers={"X-Wally-Person": "1"})
        urllib.request.urlopen(req).read()

    langs = ["es", "ca", "fr", "de", "it", "pt", "ja", "zh", "ko", "hi", "ru", "ar"]
    try:
        for lang in langs:
            set_lang(lang)
            ctx = ctx_for(b, PHONE, 3)
            p = ctx.new_page()
            p.goto(f"{base}/?month={LAST}")
            settle(p, 900)
            shot(p, os.path.join(OUT, "m_lang", f"{lang}.png"))
            ctx.close()
    finally:
        set_lang("en")
    META["m_lang"] = ["en"] + langs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost")
    ap.add_argument("only", nargs="*")
    args = ap.parse_args()
    base = args.url.rstrip("/")
    os.makedirs(OUT, exist_ok=True)
    meta_path = os.path.join(OUT, "shots.json")
    if os.path.exists(meta_path):
        META.update(json.load(open(meta_path)))
    jobs = {"summary": summary, "search": search, "recurring": recurring, "household": household,
            "phone_add": phone_add, "phone_summary": phone_summary, "household_split": household_split}
    prep_demo(base)
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--force-color-profile=srgb", "--hide-scrollbars", "--font-render-hinting=none"])
        for name, job in jobs.items():
            if args.only and name not in args.only:
                continue
            print(name)
            job(b, base)
        b.close()
    with open(meta_path, "w") as f:
        json.dump(META, f, indent=1)
    print("shots ->", os.path.relpath(meta_path, HERE))


if __name__ == "__main__":
    main()
