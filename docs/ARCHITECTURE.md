# Architecture

Browser requests the Vercel Next.js frontend, which calls the HTTPS Fastify API on Ubuntu. The API alone accesses SQLite and `FILE_STORAGE_ROOT`; the frontend never imports storage or database modules.

Large file uploads stream directly from the browser to the Fastify backend over HTTPS. Vercel never proxies upload bytes.

## API

Reads:
- `GET /health/live`
- `GET /health/ready`
- `GET /api/v1/auth/session` — `{ authenticated }` (always 200)
- `GET /api/v1/files/by-slug/:slug` — resolve a canonical `/f/:slug` URL (auth required)
- `GET /api/v1/spaces/:token`
- `GET /api/v1/spaces/:token/folders`
- `GET /api/v1/spaces/:token/files`
- `GET /api/v1/spaces/:token/trash`
- `GET /api/v1/spaces/:token/files/:publicFileId`
- `GET /api/v1/spaces/:token/files/:publicFileId/content`
- `GET /api/v1/spaces/:token/files/:publicFileId/thumbnail`
- `GET /api/v1/spaces/:token/download?ids=...` — stream a server-side ZIP of the selected files (auth required)

Writes:
- `POST /api/v1/auth/login` — verify the shared password, create a session, set cookies
- `POST /api/v1/auth/logout` — revoke the session, clear cookies
- `POST /api/v1/spaces/:token/folders` — create a folder (`{ name }`)
- `POST /api/v1/spaces/:token/files` — legacy single-request multipart upload (retained)
- `POST /api/v1/spaces/:token/uploads/init` — create a resumable upload session
- `PUT /api/v1/spaces/:token/uploads/:uploadId/chunks/:chunkIndex` — upload one chunk
- `GET /api/v1/spaces/:token/uploads/:uploadId` — query session/chunk state
- `POST /api/v1/spaces/:token/uploads/:uploadId/complete` — verify, assemble, finalize
- `DELETE /api/v1/spaces/:token/uploads/:uploadId` — cancel a session
- `POST /api/v1/spaces/:token/trash` — soft delete (`{ ids }`)
- `POST /api/v1/spaces/:token/restore` — restore from trash (`{ ids }`)
- `DELETE /api/v1/spaces/:token/trash` — permanent delete (`{ ids }`)

IDs returned to the browser are public UUIDs (`files.public_id`, `folders.public_id`). Storage keys and internal database primary keys never leave the API, and mutations validate the shared-space token, public resource id, space ownership, and current resource state on every request.

Errors use a stable typed shape:

```json
{ "error": { "code": "FILE_TOO_LARGE", "message": "This file exceeds the upload limit." } }
```

Codes include `SPACE_NOT_FOUND`, `FILE_NOT_FOUND`, `THUMBNAIL_NOT_FOUND`, `FOLDER_NOT_FOUND`, `FOLDER_EXISTS`, `INVALID_FOLDER`, `INVALID_FILENAME`, `INVALID_FILE_TYPE`, `INVALID_REQUEST`, `FILE_REQUIRED`, `FILE_EMPTY`, `FILE_TOO_LARGE`, `TOO_MANY_FILES`, `QUOTA_FILES`, `QUOTA_STORAGE`, `NOT_IN_TRASH`, `STORAGE_ERROR`, `RATE_LIMITED`, `TOO_MANY_CONCURRENT`, `UPLOAD_NOT_FOUND`, `UPLOAD_EXPIRED`, `UPLOAD_INVALID_STATE`, `UPLOAD_INCOMPLETE`, `INVALID_CHUNK`, `CHECKSUM_MISMATCH`, `UNAUTHORIZED`, `INVALID_PASSWORD`, `CSRF_MISMATCH`, and `INTERNAL_ERROR`. Stack traces, filesystem paths, SQLite errors, and internal IDs are never exposed.

## Authentication & sessions

There are no user accounts. One deployment password (bcrypt hash in `ACCESS_PASSWORD_HASH`) gates the whole app. `POST /api/v1/auth/login` verifies it with bcrypt (timing-safe), then issues an opaque 256-bit session token in an `HttpOnly`/`Secure`/`SameSite=Lax` cookie scoped to `.barnus.vizitor.hu` (so both the Vercel frontend and `api.` backend share it). Only a SHA-256 hash of the token is stored in `access_sessions`; the raw token never leaves the cookie. Sessions have a configurable TTL (`SESSION_TTL_DAYS`), a `last_seen_at` touch, and can be revoked; expired/revoked sessions are rejected and swept by maintenance (`backend:reconcile` and an in-process interval).

A `preHandler` auth hook rejects unauthenticated requests with `401 UNAUTHORIZED` on every private route, including media `<img>`/`<video>`/Range requests, thumbnails, and downloads — so the password cannot be bypassed by calling the API directly. CORS uses `credentials: true` with an exact-origin allowlist (never `*`), and state-changing requests require a double-submit CSRF token (`barnus_csrf` cookie echoed in `X-CSRF-Token`), with `SameSite=Lax` as defense in depth.

## File slugs & canonical URLs

Every file gets a permanent slug: a normalized filename prefix (lowercase, transliterated, punctuation→hyphens, extension stripped, length-capped) plus six characters of random entropy, e.g. `balaton-2024-7k3m9x`. Slugs are generated server-side with collision retry, backed by `UNIQUE(files.slug)`, immutable, and never encode internal IDs or storage keys. The canonical frontend URL is `https://barnus.vizitor.hu/f/<slug>`, resolved through `GET /api/v1/files/by-slug/:slug`. Soft-deleted files return a generic "File not found" via `/f/:slug`; restore makes the same slug resolve again; permanent delete removes it and slugs are never reused. The Share action copies this URL (via the Web Share API on mobile, clipboard otherwise); download links use the protected content endpoint with `?download=1` (forced `Content-Disposition: attachment`).

## Upload and storage lifecycle

Uploads stream to a temp file under `FILE_STORAGE_ROOT/tmp`, are counted against `MAX_UPLOAD_BYTES`, and are signature-checked against a MIME allowlist (JPEG, PNG, WebP, GIF, HEIC/HEIF, MP4, MOV/QuickTime, WebM, PDF). Browser MIME type and filename extension are never trusted. On success the temp file is atomically renamed to `FILE_STORAGE_ROOT/objects/<uuid>` and the row is committed; storage keys never contain the original filename. Failed/cancelled uploads remove their temp file, and a startup/interval sweep removes stale temp files while skipping active uploads. Soft-deleted files keep their binary and only set `deleted_at`; permanent delete is restricted to files already in Trash.

## Media processing

Media files are inserted as `processing` and handled asynchronously by a small in-process worker (bounded concurrency, no Redis). Images are processed with Sharp into WebP thumbnails (`FILE_STORAGE_ROOT/thumbs/<uuid>`), respecting EXIF orientation and preserving aspect ratio without upscaling. Videos use `ffprobe` for width/height/duration and `ffmpeg` for a single poster frame (taken at ~10–15% of duration, capped at a few seconds, never frame 0), which Sharp then resizes to WebP. Non-media files skip processing and are marked `ready` immediately.

The lifecycle is `processing` → `ready` or `failed`. A failed thumbnail/metadata job never deletes the original; the original stays downloadable through the content endpoint regardless of processing state. Failures are recorded with a capped retry budget (`PROCESSING_MAX_ATTEMPTS`); unfinished/retryable jobs are requeued on startup so a restart never permanently loses work. See `backend:reconcile` for reporting and safe repair of filesystem/DB drift.

Thumbnails are served from `GET /api/v1/spaces/:token/files/:publicFileId/thumbnail` with `image/webp` and immutable caching; the frontend polls file lists only while `processing` files exist.

## Resumable uploads

All frontend uploads use an explicit upload-session protocol so large mobile uploads survive unstable networks, page reloads, and (where IndexedDB retains the File blob) browser restarts. A session is created, chunks are uploaded independently with bounded concurrency + exponential backoff, the client reconciles missing chunks via the status endpoint, then finalizes.

Chunks are ~8 MiB (`UPLOAD_CHUNK_SIZE_BYTES`), each carrying an `X-Checksum-Sha256` header the backend verifies. Chunks are stored under `FILE_STORAGE_ROOT/upload-sessions/<internal-id>/` (internal id derived, never from client filenames), written atomically, and idempotent. `complete` verifies all chunks and size, streams them in order into one temp file (no whole-file buffering), detects the real MIME type, then reuses the same finalize path as the legacy upload (quota re-check, atomic move into `objects/`, media enqueue).

Sessions reserve their declared bytes against the space storage/file quotas, release the reservation on completion/cancel/expiry, and expire after `UPLOAD_SESSION_TTL_MS`. Startup and interval cleanup expire and remove stale sessions; a session stuck in `assembling` after a crash is reset to `uploading`. The frontend persists session metadata + the File blob in IndexedDB (falling back to file reselection when the browser evicts the blob) and offers Pause/Resume/Cancel/Reselect.

The frontend distinguishes recoverable from terminal uploads so invalid files never resurrect as "paused" after refresh. Files are validated client-side (extension allowlist mirroring the backend) before any persistence; unsupported files become an immediate terminal failure with a Remove action and are never written to IndexedDB. Backend rejections with a non-retryable status (unsupported type, too large, quota) cancel the server session and delete the persisted recovery record, while transient/network failures keep the record so the upload remains recoverable. Startup recovery also sweeps persisted records whose filenames are unsupported, cleaning up stale state from older versions.

## Observability & operational safety

SQLite runs in WAL mode with `foreign_keys=ON`, a `busy_timeout`, and `synchronous=NORMAL` (documented trade-off). The backend logs structured JSON (pino) at `LOG_LEVEL`, redacts share tokens from URLs, and issues an `X-Request-Id` per request. `/health/live` and `/health/ready` expose no private data. New upload sessions are rejected with `INSUFFICIENT_SERVER_STORAGE` before the free space falls below `MIN_FREE_DISK_BYTES`. SIGTERM/SIGINT trigger graceful shutdown (stop scheduling media jobs, drain HTTP, close SQLite) within `SHUTDOWN_GRACE_PERIOD_MS`. Backups use the SQLite online-backup API plus a filesystem copy of `objects/` and `thumbs/` (see `docs/OPERATIONS.md` and `docs/BACKUP_RESTORE.md`).

## Operations

Set `FRONTEND_ORIGIN` to the exact Vercel origin (comma-separated). CORS is strict and limited to `GET`, `POST`, `DELETE`, and `OPTIONS`. Rate limiting and upload concurrency are enforced in-process (no Redis). See `backend/.env.example` for `MAX_UPLOAD_BYTES`, `MAX_FILES_PER_SPACE`, `MAX_SPACE_STORAGE_BYTES`, and the rate/cleanup tuning.

nginx should terminate HTTPS and proxy `api.example.com` to `127.0.0.1:3001`. Use `client_max_body_size`, `proxy_request_buffering off`, `proxy_buffering off`, and long `proxy_read_timeout`/`proxy_send_timeout` aligned with the backend limits. See `docs/nginx.conf.example`.

Back up both the SQLite database and storage directory consistently. The backend binds localhost by default, so nginx is the public TLS boundary.
