"""
Take the README screenshots of Wally in every combination:
- the Summary page
- light mode
- 2 viewports: desktop (1280x800), phone (390x844)

Run it against a demo instance (sign-in is off there).
The demo's "Demo. Sample data…" bar along the top is hidden in the shots.
  docker run --rm -e DEMO=true -p 80:80 poliuscorp/wally
  pip install playwright && playwright install chromium
  python3 utils/take_screenshots.py
"""

import argparse
from datetime import date
from playwright.sync_api import sync_playwright

ASSETS_DIR = "assets"
VIEWPORTS = {"": {"width": 1280, "height": 800}, "-mobile": {"width": 390, "height": 844}}
# The Summary shows last month: a whole month reads better than the first days of this one
_first = date.today().replace(day=1)
LAST_MONTH = (_first.replace(year=_first.year - 1, month=12) if _first.month == 1 else _first.replace(month=_first.month - 1)).strftime("%Y-%m")
PAGES = [
    {"name": "dashboards", "path": "/?month=" + LAST_MONTH},
]
THEMES = ["light"]
# The demo bar along the top says the data isn't kept: true, but not part of the app being shown
HIDE_DEMO_BAR = """document.addEventListener("DOMContentLoaded", () => {
  const s = document.createElement("style");
  s.textContent = ".w-banner{display:none!important} html{--banner-h:0px!important}";
  document.head.appendChild(s);
});"""


def shoot(browser, base, path, out, theme, viewport):
    context = browser.new_context(viewport=viewport, color_scheme=theme, device_scale_factor=2)
    context.add_init_script(f"localStorage.setItem('wally.theme', '{theme}'); localStorage.setItem('wally.person', '1');")
    context.add_init_script(HIDE_DEMO_BAR)
    page = context.new_page()
    page.goto(base + path, wait_until="networkidle")
    page.wait_for_timeout(800)
    page.screenshot(path=out)
    context.close()
    print("Saved", out)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost")
    args = parser.parse_args()
    base = args.url.rstrip("/")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for theme in THEMES:
            for suffix, viewport in VIEWPORTS.items():
                for page in PAGES:
                    shoot(browser, base, page["path"], f"{ASSETS_DIR}/{page['name']}-{theme}{suffix}.png", theme, viewport)

        browser.close()


if __name__ == "__main__":
    main()
