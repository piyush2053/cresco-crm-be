# Cresco CRM System Architecture

![Cresco CRM production system architecture](./cresco-crm-system-architecture.png)

## Production topology

```mermaid
flowchart TB
  user[CRM User\nWeb Browser]
  admin[Administrator\npgAdmin / SSH]
  dns[Public DNS\ncrm.crescoglobal.co.in\nmsl.rnj.mybluehost.me]

  subgraph cloud[Internet-hosted services]
    vercel[Vercel\nReact + Vite frontend]
    gmail[Gmail SMTP\nOTP and notification email]
  end

  subgraph vps[Bluehost VPS - Ubuntu 24.04\n50.6.45.98]
    ufw[Host firewall\nPublic: 22, 80, 443]

    subgraph docker[Docker Compose: cresco-crm]
      caddy[Caddy 2\nTLS termination + reverse proxy\nPublic: 80/443]
      api[Node.js 24 / Express API\nInternal: api:4000\nHost: 127.0.0.1:4000]
      db[(PostgreSQL 16\nInternal: db:5432\nHost: 127.0.0.1:5432)]
      sched[In-process schedulers\nreports, BI, payments, alerts]

      uploads[(app_uploads volume)]
      backups[(app_backups volume)]
      pgdata[(postgres_data volume)]
      caddydata[(caddy_data/config volumes)]
    end
  end

  user -->|HTTPS| dns
  dns --> vercel
  vercel -->|REST /api, HTTPS + CORS| caddy
  caddy -->|HTTP, Docker network| api
  api -->|node-postgres| db
  api -->|SMTP/TLS| gmail
  api --- sched
  api --> uploads
  api --> backups
  db --> pgdata
  caddy --> caddydata
  ufw --- caddy
  admin -->|SSH port 22| ufw
  admin -.->|SSH tunnel: local 55432 to VPS 127.0.0.1:5432| db
```

## Application layers

```mermaid
flowchart LR
  browser[React/Vite UI] --> client[API client\nVITE_API_URL]
  client --> proxy[Caddy reverse proxy]
  proxy --> middleware[Express middleware\nCORS, JSON, cookies, errors]
  middleware --> routes[REST routes]
  routes --> controllers[Controllers]
  controllers --> services[Domain services]
  services --> pool[pg connection pool]
  pool --> postgres[(PostgreSQL)]

  routes --- domains[Auth · Users · Roles · Buyers · Suppliers\nOrders · Logistics · Finance · Reports\nNotifications · Uploads · Settings · Search]
```

## Network and configuration

| Component | Address | Exposure |
|---|---|---|
| Frontend | `https://crm.crescoglobal.co.in` | Public via Vercel |
| API | `https://msl.rnj.mybluehost.me/api` | Public via Caddy |
| Caddy | VPS ports `80`, `443` | Public |
| Node API | Docker `api:4000`, host `127.0.0.1:4000` | Private |
| PostgreSQL | Docker `db:5432`, host `127.0.0.1:5432` | Private |
| SSH | VPS port `22` | Restricted administrative access |

Runtime secrets live only in server-owned `.env.production`. The frontend receives only `VITE_API_URL`. PostgreSQL access from a workstation uses pgAdmin's SSH tunnel (VPS host `50.6.45.98`, destination `127.0.0.1:5432`) rather than exposing port 5432 publicly.

## Request and deployment flow

```mermaid
sequenceDiagram
  actor U as User
  participant F as Vercel Frontend
  participant C as Caddy
  participant A as Express API
  participant D as PostgreSQL
  U->>F: Open CRM
  F->>C: HTTPS /api request
  C->>A: Reverse proxy to api:4000
  A->>D: Parameterized SQL query
  D-->>A: Rows / transaction result
  A-->>F: JSON response
  F-->>U: Render state
```

```mermaid
flowchart LR
  dev[Developer push] --> git[Git repository]
  git --> vbuild[Vercel build/deploy]
  git --> pull[Git pull on VPS]
  pull --> compose[docker compose up -d --build]
  compose --> health[DB and API health checks]
  health --> live[Caddy serves production API]
```

## Persistence and operations

- `postgres_data` is the live database volume; a Docker volume is not a backup.
- `app_uploads` stores uploaded application files.
- `app_backups` stores application-generated backup artifacts.
- `caddy_data` retains TLS certificates; `caddy_config` retains Caddy state.
- API and database containers use health checks and `unless-stopped` restart policies.
- Scheduled jobs execute inside the API process, so only one production API scheduler instance should run unless jobs are given distributed locking.
- Database backups should be exported off-host and restore-tested regularly.
