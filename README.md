<div align="center">
<img src="web/assets/wally.png" alt="Wally Logo" width="100" height="100" />
<h1 align="center">Wally</h1>
</div>

<p align="center">
<a href="https://github.com/polius/Wally/actions/workflows/release.yml"><img src="https://github.com/polius/Wally/actions/workflows/release.yml/badge.svg" alt="Release"></a>&nbsp;<a href="https://github.com/polius/Wally/releases"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/polius/Wally"></a>&nbsp;<a href="https://hub.docker.com/r/poliuscorp/wally"><img alt="Docker Pulls" src="https://img.shields.io/docker/pulls/poliuscorp/wally"></a>
</p>

<br>

<p align="center">
<b>Wally</b> is a lightweight, self-hosted money log for a household: what came in, where it went, and what's coming.
</p>

<br>

| | Desktop View | Mobile View |
| --- | --- | --- |
| Light | <img src="assets/dashboards-light.png?version=2.0" alt="Dashboards Light" /> | <img src="assets/dashboards-light-mobile.png?version=2.0" alt="Dashboards Light Mobile" /> |
| Dark | <img src="assets/dashboards-dark.png?version=2.0" alt="Dashboards Dark" /> | <img src="assets/dashboards-dark-mobile.png?version=2.0" alt="Dashboards Dark Mobile" /> |

<details>
<summary>Expand this to see screenshots of other pages</summary>

| | Desktop View | Mobile View |
| --- | --- | --- |
| Transactions Light | <img src="assets/transactions-light.png?version=2.0" alt="Transactions Light" /> | <img src="assets/transactions-light-mobile.png?version=2.0" alt="Transactions Light Mobile " /> |
| Transactions Dark | <img src="assets/transactions-dark.png?version=2.0" alt="Transactions Dark" /> | <img src="assets/transactions-dark-mobile.png?version=2.0" alt="Transactions Dark Mobile" /> |
| Settings Light | <img src="assets/settings-light.png?version=2.0" alt="Settings Light" /> | <img src="assets/settings-light-mobile.png?version=2.0" alt="Settings Light Mobile" /> |
| Settings Dark | <img src="assets/settings-dark.png?version=2.0" alt="Settings Dark" /> | <img src="assets/settings-dark-mobile.png?version=2.0" alt="Settings Dark Mobile" /> |
| Login Light | <img src="assets/login-light.png?version=2.0" alt="Login Light" /> | <img src="assets/login-light-mobile.png?version=2.0" alt="Login Light Mobile" /> |
| Login Dark | <img src="assets/login-dark.png?version=2.0" alt="Login Dark" /> | <img src="assets/login-dark-mobile.png?version=2.0" alt="Login Dark Mobile" /> |

</details>

## Quick Demo

Want to try Wally quickly? Run this command to start a demo instance with sample data:

```bash
docker run --rm -e DEMO=true -p 80:80 poliuscorp/wally
```

Then open [http://localhost](http://localhost) in your browser.

> **Note:** This runs in demo mode with pre-loaded data. Your changes won't persist after stopping the container. For a permanent installation, see below.

## Installation

### Run with Docker CLI

```bash
docker run -d \
  --name wally \
  -p 80:80 \
  -v $(pwd):/wally/data \
  poliuscorp/wally
```

- The `-v` flag ensures your data persists when the container restarts or is updated.
- Replace `$(pwd)` with the folder on your host where you want Wally to store its database.

Access Wally at: [http://localhost](http://localhost)

### Run with Docker Compose

```yaml
services:
  wally:
    image: poliuscorp/wally
    container_name: wally
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      - $(pwd):/wally/data
```

- Replace `$(pwd)` with the folder on your host where you want Wally to store its database.

Access Wally at: [http://localhost](http://localhost)

## What's in Wally

- **Dashboard**: what this month has spent against last month, where the money went, how much you kept each month, and what's coming. Every number opens the transactions behind it.
- **Transactions**: any range, search across every month (`mercadona`, `#holiday`, `@ana`, `>50`, `march`), a calendar, bulk changes, and Undo.
- **Recurring**: bills, subscriptions and salaries, added on their day by the server. Wally notices price rises and payees that look like they repeat.
- **People**: each person's money, and shared costs split evenly, by income or by hand.
- **Month in review** on the 1st, and a command bar (⌘K).
- **One password for the household**: pick your name, type the password. Optional two-step sign-in, one code for everyone's phone. Sign-in is optional, as before.
- **End-to-end encryption**, optional: your devices encrypt everything before it reaches the server, so whoever runs it can't read it. See [below](#end-to-end-encryption).
- **Import** from your bank's CSV: rows you already typed are matched, not added twice, and Wally learns your categories.
- **Backups** every night, in the data folder.
- **Installs on your phone's home screen** and opens full screen. Light and dark, 13 languages.

Wally never connects to a bank. You type what you spend, or import a file.

## Upgrading from 1.x

Nothing to do: start the new image with the same data folder. Every 1.x release, from 1.0 to 1.16, upgrades.

- **Before**, Wally copies your database to `backups/pre-2.0-<date>.db` in the data folder.
- **During**, before keeping anything, Wally compares the result with your old data, field by field: every transaction, recurring rule, category, tag, currency and setting. If anything differs that shouldn't, it puts your data back exactly as it was, opens read-only, and says why. The 1.x image opens the copy.
- **After**, each person is welcomed to 2.0 once, with how many transactions came across. The full report of what was kept (transactions, totals, rules, categories) and what changed is saved as `upgrade-report-<date>.txt` in the data folder.

To see the report before upgrading, run the check on a copy. It changes nothing:

```bash
docker run --rm -v /path/to/your/data:/wally/data poliuscorp/wally python3 -m api.upgrade --check
```

What changes on purpose:

- The first time it opens, Wally asks who uses it. Existing transactions stay shared by the household; a tag you used for a person can become that person in **Settings › People**.
- If you had a password, it stays the household's password: everyone picks their name and signs in with it. 1.x had no Emergency Kit, so whoever signs in first is asked to save one.
- Recurring transactions are no longer created in advance: each one is added on its day. Those 1.x had already added for dates after today are taken out, listed in the report, and come back on their day.

## Environment variables

Wally supports the following environment variables:

| Variable | Sample Value | Details |
| --- | --- | --- |
| DEMO | true | Pre-loads the app with sample data for a household of two. Nothing is kept. |
| TZ | Europe/Madrid | The household's time zone, for when recurring transactions are added. Can also be set in **Settings › Appearance**. |
| WALLY_ENCRYPTION | required | For running Wally for someone else: every household is end-to-end encrypted from setup, and encryption and sign-in can't be turned off, so you can't read their data. Needs HTTPS. Ignored with DEMO. |

## Forgot your password

Everyone uses the same password, so first ask someone else in the household.

Otherwise, use the **Emergency Kit**. Wally gives the household one when sign-in is turned on: a recovery key to print, download or keep in a password manager. On the sign-in screen, pick your name, choose **Forgot password**, type the recovery key, then choose a new household password. No two-step code is needed, so the kit also gets you in when no phone is at hand. Every other browser then signs in again with the new password. Make a new kit in **Settings › Sign-in**; the old one stops working.

Lost the kit too? Whoever runs the server can turn sign-in off, then you turn it on again with a new password:

```bash
docker exec wally python3 -m api.signin_off
```

This doesn't work while the household is encrypted: then nobody can open the data without the password or the kit.

## End-to-end encryption

When you set Wally up with a password, it asks **who runs this server**. Answer *someone else* and Wally is encrypted right then, before anything is saved. You can also turn it on later in **Settings › Privacy** (sign-in must be on, and Wally must be opened over HTTPS: browsers only encrypt on secure pages). If you run Wally for other people, set `WALLY_ENCRYPTION=required`: setup then encrypts every household without asking, nothing is saved in the clear, and it can't be turned off. Your browser encrypts every transaction, rule, category and tag with a household key; the server keeps only what it can't open.

- **What the server can still see**: people's names, sign-ins, settings, how many records there are and when they change. Not one amount, name or category.
- **The password**: the household password is the key. Your browser turns it into keys (Argon2id) and never sends it, and each browser asks for it once. Everyone keeps using the same password; nobody needs a code to join.
- **The Emergency Kit**: turning encryption on gives the household a new one; its recovery key also opens the household key, in your browser. **Forgot password** works as above, and it's the only way back in: whoever runs the server can't turn sign-in off. Turning encryption off gives you a new kit again.
- **If nobody can get in** (the password forgotten and the kit lost), the data can't be opened by anyone. That is the point, so keep your Emergency Kit.
- **Off while encrypted**: API keys and phone shortcuts (the server can't read or add to the data), and turning sign-in off.
- **Turning it on or off** builds a new database file next to the old one, checks it, and only then switches. Wally is read-only for about a minute. If Wally or the browser stops half-way, the old file is used, untouched. Turning it on deletes backups made before, which are in the clear; download them first if you want them.
- **Limits**: the server sends the web app, so someone who controls the server could change it to capture a password the next time it is typed. It can also delete records or bring back old ones. End-to-end encryption protects what is stored, not a server that is actively attacking you.

## Data Import / Export

Wally imports CSV files from **Settings › Import and export**: its own exports, Wally 1.x exports, and bank exports (you choose which column is which). The preview shows what is new, what matches something you already typed, and what was imported before, before anything is saved.

The Wally 1.x format is still accepted:

```
name,category,type,amount,date,tags
An expense,Rent,expense,1000.0,2025-08-01,
An income,Salary,income,2000.0,2025-08-01,"Tag1,Tag2"
```

Wally 2.0 exports add `person`, `paid_by`, `shares` and `note`.

## API

Wally's API is documented at http://localhost/api/docs. Create a key in **Settings › API keys** and send it as the `X-API-Key` header. What you add with a key is added by the person who made it. Settings also shows how to add expenses from your phone's lock screen with a shortcut.

## Development

```bash
pip install -r api/requirements.txt pytest httpx
python -m pytest tests                                     # API tests
WALLY_DATA=/tmp/wally DEMO=true python -m uvicorn utils.dev_server:app --port 8080
python utils/i18n.py --check                               # every language has every string
```

## Acknowledgement

Wally has been built using [ExpenseOwl](https://github.com/Tanq16/ExpenseOwl) as an inspiration, and many ideas were derived from that project.
