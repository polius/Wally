<div align="center">
<img src="/web/assets/wally.png" alt="Wally Logo" width="120" height="120" />
<h1 align="center">Wally</h1>
</div>

<p align="center">
<a href="https://github.com/polius/Wally/actions/workflows/release.yml"><img src="https://github.com/polius/Wally/actions/workflows/release.yml/badge.svg" alt="Release"></a>&nbsp;<a href="https://github.com/polius/Wally/releases"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/polius/Wally"></a>&nbsp;<a href="https://hub.docker.com/r/poliuscorp/wally"><img alt="Docker Pulls" src="https://img.shields.io/docker/pulls/poliuscorp/wally"></a>
</p>

<br>

<p align="center">
<b>Wally</b> is a lightweight, self-hosted expense tracker that makes it easy to manage your finances.
</p>

<br>

| | Desktop View | Mobile View |
| --- | --- | --- |
| Light | <img src="/assets/dashboards-light.png" alt="Dashboards Light" /> | <img src="/assets/dashboards-light-mobile.png" alt="Dashboards Light Mobile" /> |
| Dark | <img src="/assets/dashboards-dark.png" alt="Dashboards Dark" /> | <img src="/assets/dashboards-dark-mobile.png" alt="Dashboards Dark Mobile" /> |

<details>
<summary>Expand this to see screenshots of other pages</summary>

| | Desktop View | Mobile View |
| --- | --- | --- |
| Transactions Light | <img src="/assets/transactions-light.png" alt="Transactions Light" /> | <img src="/assets/transactions-light-mobile.png" alt="Transactions Light Mobile " /> |
| Transactions Dark | <img src="/assets/transactions-dark.png" alt="Transactions Dark" /> | <img src="/assets/transactions-dark-mobile.png" alt="Transactions Dark Mobile" /> |
| Settings Light | <img src="/assets/settings-light.png" alt="Settings Light" /> | <img src="/assets/settings-light-mobile.png" alt="Settings Light Mobile" /> |
| Settings Dark | <img src="/assets/settings-dark.png" alt="Settings Dark" /> | <img src="/assets/settings-dark-mobile.png" alt="Settings Dark Mobile" /> |
| Login Light | <img src="/assets/login-light.png" alt="Login Light" /> | <img src="/assets/login-light-mobile.png" alt="Login Light Mobile" /> |
| Login Dark | <img src="/assets/login-dark.png" alt="Login Dark" /> | <img src="/assets/login-dark-mobile.png" alt="Login Dark Mobile" /> |

</details>

## Installation

The recommended installation method is **Docker**.  

#### Run with Docker CLI

```bash
docker run -d \
  --name wally \
  -p 80:80 \
  -v /path/to/data:/wally/data \
  -e DEMO=true \   # Optional: pre-loads the app with random demo data
  poliuscorp/wally
```

- The `-v` flag ensures your data persists when the container restarts or is updated.
- Replace `/path/to/data` with the folder on your host where you want Wally to store its database.

#### Run with Docker Compose

```yaml
services:
  wally:
    image: poliuscorp/wally
    container_name: wally
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      - /path/to/data:/wally/data
    # Optional: pre-loads the app with random demo data
    environment:
      DEMO: "true"
```

Once deployed, use the web interface to do everything. Access it through your browser:

[http://localhost/](http://localhost/)

## Data Import / Export

Wally supports CSV import/export. The file must contain the following columns:

```
name,category,type,amount,date,tags
```

**Example**

```
name,category,type,amount,date,tags
An expense,Rent,expense,1000.0,2025-08-01,
An income,Salary,income,2000.0,2025-08-01,"Tag1,Tag2"
```

- `type` can be `income` or `expense`.
- `tags` are optional and can be multiple, separated by commas.

This can be done directly from the **Settings** page.

## Acknowledgement

Wally has been built using [ExpenseOwl](https://github.com/Tanq16/ExpenseOwl) as an inspiration, and many ideas were derived from that project.
