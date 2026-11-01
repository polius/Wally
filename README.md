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
- **Your own password for each person**, with optional two-step sign-in. Optional for the whole household, as before.
- **End-to-end encryption**, optional: your devices encrypt everything before it reaches the server, so whoever runs it can't read it. See [below](#end-to-end-encryption).
- **Import** from your bank's CSV: rows you already typed are matched, not added twice, and Wally learns your categories.
- **Backups** every night, in the data folder.
- **Installs on your phone's home screen** and opens full screen. Light and dark, 13 languages.

Wally never connects to a bank. You type what you spend, or import a file.

## Upgrading from 1.x

Nothing to do: start the new image with the same data folder. Before changing anything, Wally copies your database to `backups/pre-2.0-<date>.db` in the data folder. If the upgrade fails, Wally puts your data back as it was and says why; the 1.x image opens the copy.

- The first time it opens, Wally asks who uses it. Existing transactions stay shared by the household; a tag you used for a person can become that person in **Settings › People**.
- If you had a password, it becomes everyone's first password. Each person chooses their own at their next sign-in.
- Recurring transactions are no longer created in advance: each one is added on its day.

## Environment variables

Wally supports the following environment variables:

| Variable | Sample Value | Details |
| --- | --- | --- |
| DEMO | true | Pre-loads the app with sample data for a household of two. Nothing is kept. |
| TZ | Europe/Madrid | The household's time zone, for when recurring transactions are added. Can also be set in **Settings › Appearance**. |
| WALLY_ENCRYPTION | required | For running Wally for someone else: every household is end-to-end encrypted from setup, and encryption and sign-in can't be turned off, so you can't read their data. Needs HTTPS. Ignored with DEMO. |

## Forgot your password

On the sign-in screen, pick your name and choose **Forgot password**. Wally writes a one-time password for you to `password.txt` in the container's working folder (`docker exec wally cat /wally/password.txt`). Signing in with it turns your two-step sign-in off, so a lost phone never locks anyone out, and asks you to choose a new password.

With encryption on, whoever runs the server can't reset a password: see the next section.

## End-to-end encryption

When you set Wally up with a password, it asks **who runs this server**. Answer *someone else* and Wally is encrypted right then, before anything is saved. You can also turn it on later in **Settings › Privacy** (sign-in must be on, and Wally must be opened over HTTPS: browsers only encrypt on secure pages). If you run Wally for other people, set `WALLY_ENCRYPTION=required`: setup then encrypts every household without asking, nothing is saved in the clear, and it can't be turned off. Your browser encrypts every transaction, rule, category and tag with a household key; the server keeps only what it can't open.

- **What the server can still see**: people's names, sign-ins, settings, how many records there are and when they change. Not one amount, name or category.
- **Passwords**: your browser turns your password into keys (Argon2id) and never sends it. Each person gets an **Emergency Kit** with a recovery key to print and keep. If someone loses both, another person in the household can make them a one-use code in **Settings › People**. Their two-step sign-in still asks for its code; `password.txt` can still turn two-step off, but opens nothing.
- **If nobody can get in**, the data can't be opened by anyone. That is the point, so keep your Emergency Kit.
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
