Quick start

1. Start DB and API via Docker Compose:

```bash
docker compose up --build -d
```

2. Initialize DB (locally):

```bash
psql -h localhost -U postgres -f db-init.sql
```

3. Run API locally (after `npm install`):

```bash
npm run dev
```

Notes:
- Config is in `src/config.js`. The repo intentionally stores secrets there per request.
- Replace SMTP credentials in `src/config.js` with a valid Gmail app password.
- Initial admin: `admin@cresco.local` with password `Admin@1234` (bcrypt-hashed in `db-init.sql`).
