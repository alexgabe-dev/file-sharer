# Ubuntu Deployment

The frontend runs on Vercel; the API, SQLite database, and media files live on a single Ubuntu VPS. nginx terminates TLS in front of the Fastify backend (see `docs/nginx.conf.example`).

## System packages

Install FFmpeg for video metadata and poster generation. Media thumbnails use Sharp, whose prebuilt binaries ship their own libvips and require no extra OS packages (no `libvips` system install needed). HEIC/HEIF decoding depends on the Sharp/libvips build; when unavailable, the original is still stored and downloadable with a generic fallback preview.

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg
```

Verify:

```bash
ffmpeg -version
ffprobe -version
```

Do not bundle FFmpeg into the frontend and never run it on Vercel.

## Node runtime

Use the same major Node version locally and on the VPS. `sharp` uses N-API (ABI-stable), so it works across Node versions without native rebuilds.

## Environment

Copy `backend/.env.example` to `backend/.env` and set the deployment values. Media-relevant variables:

- `FFMPEG_PATH` / `FFPROBE_PATH` — defaults `ffmpeg` / `ffprobe`
- `MEDIA_PROCESSING_CONCURRENCY` — bounded FFmpeg/Sharp workers (default `1`)
- `MEDIA_PROCESSING_TIMEOUT_MS` — kill stuck jobs (default `120000`)
- `THUMBNAIL_MAX_DIMENSION` — default `512`
- `MAX_PROCESSABLE_IMAGE_PIXELS` / `MAX_PROCESSABLE_VIDEO_DURATION_SECONDS` — safety guards
- `PROCESSING_MAX_ATTEMPTS` — retry budget before a file stays `failed`

Resumable-upload variables:

- `UPLOAD_CHUNK_SIZE_BYTES` — chunk size (default `8388608` = 8 MiB); balances request count vs retry cost
- `MAX_UPLOAD_CHUNKS` — hard cap on declared chunk count (default `8192`)
- `UPLOAD_SESSION_TTL_MS` — how long an unfinished session is resumable (default 24 h)
- `UPLOAD_SESSION_CLEANUP_INTERVAL_MS` — stale-session sweep interval

nginx only needs `client_max_body_size` above one chunk (~16 MiB) for the chunk `PUT` requests, plus `proxy_request_buffering off`. Keep `proxy_read_timeout`/`proxy_send_timeout` long for slow mobile networks.

## Authentication & sessions

The app is private: there are no user accounts, only one deployment password that every visitor enters once. The backend enforces the password gate on **every** private route (spaces, files, folders, thumbnails, content, range requests, uploads, mutations); the only public routes are `/health/live`, `/health/ready`, and `/api/v1/auth/*`. Bypassing the frontend and calling the API directly still requires a valid session cookie.

Set these in `backend/.env`:

```ini
# Production: a bcrypt hash of the shared password (see below). Prefer this over plaintext.
ACCESS_PASSWORD_HASH=$2b$12$...
# Development only: plaintext password, hashed once at startup. Do NOT set in production.
#ACCESS_PASSWORD=dev-password
SESSION_TTL_DAYS=30
SESSION_COOKIE_NAME=barnus_session
SESSION_COOKIE_DOMAIN=.barnus.vizitor.hu
AUTH_RATE_LIMIT_MAX=5
AUTH_RATE_LIMIT_WINDOW_MS=60000
```

Generate a bcrypt hash (use Node, matching the backend's `bcryptjs`):

```bash
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 12))" 'your-password'
```

If neither `ACCESS_PASSWORD_HASH` nor `ACCESS_PASSWORD` is set, the backend still starts but login always fails with the generic "Invalid password." — the app is effectively locked. Do not expose the password through any `NEXT_PUBLIC_*` variable and never put it in the frontend bundle.

The session cookie is `HttpOnly`, `Secure` (over HTTPS), `SameSite=Lax`, `Path=/`, and scoped to `SESSION_COOKIE_DOMAIN` (`.barnus.vizitor.hu`), which both `barnus.vizitor.hu` and `api.barnus.vizitor.hu` share. A separate non-HttpOnly `barnus_csrf` cookie carries the double-submit CSRF token; state-changing requests must echo it in `X-CSRF-Token`. Sessions are stored server-side in SQLite (`access_sessions`, token hashed with SHA-256); expired/revoked sessions are rejected and swept by maintenance. Logins are rate-limited per IP (`AUTH_RATE_LIMIT_MAX` per `AUTH_RATE_LIMIT_WINDOW_MS`).

## File slugs

Every file receives a permanent, URL-safe slug (e.g. `balaton-2024-7k3m9x`) that powers the canonical frontend URL `https://barnus.vizitor.hu/f/<slug>`. Slugs are generated server-side, are unique, never expose internal IDs, and are immutable. `backend:migrate` also backfills slugs for pre-existing files (idempotent).

## Backups

Back up the SQLite database and `FILE_STORAGE_ROOT` (including `objects/` and `thumbs/`) together, since rows reference both originals and derived thumbnails.

## Maintenance

```bash
npm run backend:reconcile          # report drift (missing originals, orphan thumbs, stale temps, stuck jobs)
npm run backend:reconcile -- --repair  # apply safe repairs (remove orphan thumbs, clear dangling keys, requeue media)
```

Reconciliation never permanently deletes user originals. It reports issues and, with `--repair`, only removes orphaned derived thumbnails, clears dangling thumbnail keys, and requeues unfinished media for processing on the next startup.

## Operational safety

Operational variables (in `backend/.env`):

- `LOG_LEVEL` — pino structured-log level (default `info`); share tokens are redacted from logs
- `SHUTDOWN_GRACE_PERIOD_MS` — graceful-drain budget before forced exit (default `15000`)
- `MIN_FREE_DISK_BYTES` — disk reserve; new upload sessions are rejected before hitting `ENOSPC` (default 1 GiB)
- `BACKUP_ROOT` / `BACKUP_RETENTION_DAYS` — backup location and retention (default `./backups`, 7 days)

Commands: `backend:migrate`, `backend:status`, `backend:backup`, `backend:restore`, `backend:reconcile`.

See `docs/OPERATIONS.md` for the full Ubuntu runbook (service user, systemd, nginx, health checks, deployment, rollback) and `docs/BACKUP_RESTORE.md` for backup/restore procedures. A systemd unit example is at `docs/shared-files.service.example`.
