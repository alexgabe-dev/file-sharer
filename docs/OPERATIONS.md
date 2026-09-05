# Operations

Practical runbook for running the Fastify backend on a single Ubuntu VPS behind nginx. The frontend runs on Vercel and calls this API directly over HTTPS.

## Service user

Create a dedicated non-root user that owns only the application, database, storage, and backup directories.

```bash
sudo useradd --system --home /opt/shared-files --shell /usr/sbin/nologin shared-files
sudo mkdir -p /opt/shared-files /var/lib/shared-files/database /var/lib/shared-files/storage /var/lib/shared-files/backups
sudo chown -R shared-files:shared-files /opt/shared-files /var/lib/shared-files
```

The backend never runs as root, binds only to `127.0.0.1`, and is reached only through nginx. FFmpeg/Sharp run under the same service user.

## Storage layout

```
/var/lib/shared-files/
  database/shared-files.db      # SQLite (+ -wal/-shm)
  storage/
    objects/                    # original file binaries
    thumbs/                     # generated WebP thumbnails/posters
    upload-sessions/            # in-progress chunk data (not backed up)
    tmp/                        # transient assembly/write temp files
  backups/                      # created by backend:backup
```

## Environment

Copy `backend/.env.example` to `backend/.env` and set production values:

```ini
PORT=3001
DATABASE_PATH=/var/lib/shared-files/database/shared-files.db
FILE_STORAGE_ROOT=/var/lib/shared-files/storage
FRONTEND_ORIGIN=https://barnus.vizitor.hu
PUBLIC_API_BASE_URL=https://api.barnus.vizitor.hu
LOG_LEVEL=info
SHUTDOWN_GRACE_PERIOD_MS=15000
MIN_FREE_DISK_BYTES=1073741824
BACKUP_ROOT=/var/lib/shared-files/backups
BACKUP_RETENTION_DAYS=7
ACCESS_PASSWORD_HASH=           # bcrypt hash of the shared password (required in production)
SESSION_TTL_DAYS=30
SESSION_COOKIE_NAME=barnus_session
SESSION_COOKIE_DOMAIN=.barnus.vizitor.hu
AUTH_RATE_LIMIT_MAX=5
AUTH_RATE_LIMIT_WINDOW_MS=60000
```

`FRONTEND_ORIGIN` is the exact Vercel production origin (comma-separated for previews if needed). Never use a wildcard. Generate `ACCESS_PASSWORD_HASH` with `node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 12))" 'your-password'`.

## systemd

```bash
sudo cp docs/shared-files.service.example /etc/systemd/system/shared-files.service
sudo systemctl daemon-reload
sudo systemctl enable --now shared-files
sudo systemctl status shared-files
```

Logs: `journalctl -u shared-files -f`. Backend request logs are structured JSON (pino) with redacted share tokens and an `X-Request-Id`.

## Health checks

- `GET /health/live` — process is running.
- `GET /health/ready` — SQLite reachable + storage writable; returns 503 otherwise.

```bash
curl -s http://127.0.0.1:3001/health/live
curl -s http://127.0.0.1:3001/health/ready
```

## Deployment sequence

```bash
# 1. back up
sudo -u shared-files npm run backend:backup

# 2. deploy code
git pull            # or copy the artifact
npm ci

# 3. build + run migrations (idempotent)
npm run backend:build
npm run backend:migrate

# 4. restart
sudo systemctl restart shared-files

# 5. health check
curl -s http://127.0.0.1:3001/health/ready
```

Migrations are forward-only and recorded in `schema_migrations`; startup also runs them idempotently and fails fast on malformed state. `backend:migrate` also backfills file slugs for pre-existing files (idempotent), so `/f/:slug` links work immediately after upgrading. The frontend deploys independently on Vercel.

## Restart behavior

systemd sends `SIGTERM`; the backend stops scheduling new media jobs, drains in-flight HTTP within `SHUTDOWN_GRACE_PERIOD_MS`, closes SQLite, and exits. Interrupted resumable upload sessions and unfinished media jobs are requeued on next startup.

## Disk capacity

Before creating a new upload session the backend checks free space against `MIN_FREE_DISK_BYTES` and rejects with `INSUFFICIENT_SERVER_STORAGE` rather than hitting `ENOSPC`. Keep `MIN_FREE_DISK_BYTES` above your largest expected single file.

## Local status

```bash
sudo -u shared-files npm run backend:status
```

Reports DB reachability + migration version, storage writability + free space, FFmpeg/ffprobe availability, and active job/session counts (admin CLI only, not a public endpoint).

## Reconciliation

```bash
sudo -u shared-files npm run backend:reconcile           # report drift
sudo -u shared-files npm run backend:reconcile -- --repair  # safe repairs only
```

Never run with `--repair` without first reviewing the report. It never deletes original user files. Expired/revoked access sessions are swept both by an in-process interval and by `backend:reconcile --repair`.

## Vercel frontend

Set `NEXT_PUBLIC_API_BASE_URL=https://api.barnus.vizitor.hu` in Vercel, plus `NEXT_PUBLIC_SPACE_TOKEN` to the single private space's public token (this routes the root `/` to that space; it is a routing identifier, not a secret — access is gated by the session cookie). There is no localhost fallback in production; the frontend uploads and streams directly to the API origin, never through Vercel. `next.config.mjs` keeps images unoptimized so the API serves media directly, and emits `Referrer-Policy: strict-origin-when-cross-origin` + `X-Content-Type-Options: nosniff`. The layout also sets `robots: noindex` so private `/f/*` links never reach search engines.

## Rollback

Backend: restore the previous code, run `backend:migrate` (no-op for already-applied migrations), restart, health-check. If a migration has already applied data changes, roll back the database from the last backup (see `docs/BACKUP_RESTORE.md`) rather than editing the schema.
