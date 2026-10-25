"""
Take the README screenshots of Wally in every combination:
- 4 pages: sign-in, dashboard, transactions, settings
- 2 themes: light, dark
- 2 viewports: desktop (1280x800), phone (390x844)

Run it against a demo instance (sign-in is off there; it is turned on only for the sign-in shots):
  docker run --rm -e DEMO=true -p 80:80 poliuscorp/wally
  pip install playwright requests && playwright install chromium
  python3 utils/take_screenshots.py
"""

import argparse
import requests
from playwright.sync_api import sync_playwright

ASSETS_DIR = "assets"
VIEWPORTS = {"": {"width": 1280, "height": 800}, "-mobile": {"width": 390, "height": 844}}
PAGES = [
    {"name": "dashboards", "path": "/"},
    {"name": "transactions", "path": "/transactions"},
    {"name": "settings", "path": "/settings/people"},
]
THEMES = ["light", "dark"]
PASSWORDS = {"1": "screenshots-1", "2": "screenshots-2"}


def shoot(browser, base, path, out, theme, viewport, signed_in=True):
    context = browser.new_context(viewport=viewport, color_scheme=theme, device_scale_factor=2)
    context.add_init_script(f"localStorage.setItem('wally.theme', '{theme}');" + ("localStorage.setItem('wally.person', '1');" if signed_in else ""))
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

        # The sign-in screen: turn sign-in on for the shots, then off again
        session = requests.Session()
        session.headers["X-Wally-Person"] = "1"
        session.put(f"{base}/api/signin", json={"enabled": True, "passwords": PASSWORDS}).raise_for_status()
        try:
            for theme in THEMES:
                for suffix, viewport in VIEWPORTS.items():
                    shoot(browser, base, "/", f"{ASSETS_DIR}/login-{theme}{suffix}.png", theme, viewport, signed_in=False)
        finally:
            session.put(f"{base}/api/signin", json={"enabled": False, "current": PASSWORDS["1"]}).raise_for_status()
        browser.close()


if __name__ == "__main__":
    main()
