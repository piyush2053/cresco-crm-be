# Cresco CRM backend deployment — Ubuntu 24.04 LTS

This setup runs Node.js, PostgreSQL and Caddy in Docker. Only ports 80, 443 and SSH are public. PostgreSQL and the Node.js port bind to `127.0.0.1`, so pgAdmin must use an SSH tunnel.

## 1. Before deployment

1. Create a DNS `A` record such as `api-crm.yourdomain.com` pointing to the VPS public IP.
2. Rotate the Gmail app password and JWT secret that previously existed in source code. Never push `.env.production`.
3. Confirm that `package-lock.json` is committed alongside `package.json`.

## 2. Secure the Ubuntu server

Log in initially as root:

```bash
ssh root@YOUR_VPS_IP
apt update && apt upgrade -y
apt install -y ca-certificates curl git ufw
adduser deploy
usermod -aG sudo deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Open a new terminal and verify `ssh deploy@YOUR_VPS_IP` before closing the root session.

## 3. Install Docker Engine

Run as the `deploy` user:

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker deploy
```

Log out and back in, then check:

```bash
docker version
docker compose version
docker run --rm hello-world
```

## 4. Clone and configure Cresco CRM

```bash
sudo mkdir -p /opt/cresco-crm-be
sudo chown deploy:deploy /opt/cresco-crm-be
git clone https://github.com/piyush2053/cresco-crm-be.git /opt/cresco-crm-be
cd /opt/cresco-crm-be
cp .env.example .env.production
chmod 600 .env.production
openssl rand -hex 32
openssl rand -hex 32
nano .env.production
```

Use the first generated value for both `POSTGRES_PASSWORD` and `DB_PASSWORD`. Use the second, different value for `JWT_SECRET`. Set:

```dotenv
API_DOMAIN=api-crm.yourdomain.com
API_URL=https://api-crm.yourdomain.com
CORS_ORIGINS=https://your-production-frontend.vercel.app
POSTGRES_DB=cresco_prod
POSTGRES_USER=cresco_app
DB_HOST=db
DB_PORT=5432
DB_NAME=cresco_prod
DB_USER=cresco_app
```

Add the newly rotated Gmail app password to `SMTP_PASS`. Multiple exact frontend origins can be comma-separated in `CORS_ORIGINS`.

## 5. Start and verify

```bash
cd /opt/cresco-crm-be
docker compose --env-file .env.production config
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail=100 api
curl http://127.0.0.1:4000/
curl https://api-crm.yourdomain.com/
```

Caddy obtains and renews HTTPS automatically after DNS points to the VPS and ports 80/443 are reachable.

## 6. pgAdmin connection from the local computer

Do not open public port 5432. In pgAdmin, create a server with these settings:

Connection tab:

- Host: `127.0.0.1`
- Port: `5432`
- Maintenance database: `cresco_prod`
- Username: `cresco_app`
- Password: the value stored in server `.env.production` as `POSTGRES_PASSWORD`

SSH Tunnel tab:

- Use SSH tunneling: `Yes`
- Tunnel host: VPS public IP
- Tunnel port: `22`
- Username: `deploy`
- Authentication: your SSH private key

If pgAdmin does not support the needed key format, make a local tunnel first:

```powershell
ssh -N -L 55432:127.0.0.1:5432 deploy@YOUR_VPS_IP
```

Then connect pgAdmin to `127.0.0.1:55432` with the same database credentials.

## 7. Move the local database manually

Recommended pgAdmin flow:

1. On local `cresco_local`, choose **Backup**.
2. Select **Custom** format and save `cresco_local.backup`.
3. Connect to VPS through the SSH tunnel.
4. Select `cresco_prod` and choose **Restore**.
5. Select the custom backup. Under restore options enable **No owner** and **No privileges**.
6. For the first empty restore, leave **Clean before restore** off. Use it only when intentionally replacing an existing database after taking a backup.
7. Verify tables and row counts, then test login and the dashboard API.

CLI alternative from the VPS after copying the backup to `/tmp/cresco_local.backup`:

```bash
docker cp /tmp/cresco_local.backup cresco-crm-db-1:/tmp/cresco_local.backup
docker compose --env-file .env.production exec db pg_restore --no-owner --no-privileges --clean --if-exists -U cresco_app -d cresco_prod /tmp/cresco_local.backup
```

`--clean` replaces existing objects, so use that CLI command only when replacement is intended.

## 8. Configure GitHub Actions deployment

Create a dedicated deployment key on your local computer:

```powershell
ssh-keygen -t ed25519 -C "cresco-github-deploy" -f "$HOME\.ssh\cresco_github_deploy"
Get-Content "$HOME\.ssh\cresco_github_deploy.pub"
```

Append the public key to `/home/deploy/.ssh/authorized_keys` on the VPS. In GitHub repository **Settings → Secrets and variables → Actions**, add:

- `VPS_HOST`: VPS public IP
- `VPS_PORT`: `22`
- `VPS_USER`: `deploy`
- `VPS_SSH_PRIVATE_KEY`: complete contents of `cresco_github_deploy` (the private key)

Pushes to `main` then validate Node.js, build the Docker image, connect over SSH, pull with fast-forward only, rebuild, and health-check the API. The server-owned `.env.production` is never overwritten.

## 9. Routine operations

```bash
cd /opt/cresco-crm-be
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs -f --tail=200 api
docker compose --env-file .env.production restart api
docker compose --env-file .env.production pull
docker system df
docker compose --env-file .env.production exec db psql -U cresco_app -d cresco_prod
```

Named volume `postgres_data` contains the database. A Docker volume is not a backup; keep the separate scheduled PostgreSQL dump process and test restores regularly.

## 10. Automated backups and cache maintenance

Install the supplied systemd units after deployment:

```bash
sudo cp deploy/systemd/cresco-* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cresco-db-backup.timer cresco-db-backup-email.timer cresco-docker-cache-clean.timer
systemctl list-timers 'cresco-*'
```

The daily job creates a compressed PostgreSQL custom-format `.backup`, validates it with `pg_restore --list`, and only then removes older backups so exactly one validated backup remains. The weekly job emails that file to every active, verified administrator. The cache job removes only unused Docker build cache older than seven days; it does not prune containers, images, or volumes.

Check job output with `journalctl -u cresco-db-backup.service`, `journalctl -u cresco-db-backup-email.service`, and `journalctl -u cresco-docker-cache-clean.service`.
