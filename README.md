# Shared Files

The Next.js frontend is deployed to Vercel and calls the independent Fastify API on the Ubuntu VPS over HTTPS. Large uploads stream directly from the browser to the API; they are never proxied through Vercel. Configure `.env.local` from `.env.example`, backend environment from `backend/.env.example`, then run `npm run dev` and `npm run backend:dev` separately.

Run `npm run backend:seed` only in development. The API supports listing, metadata, secure range-based delivery, resumable/chunked uploads (with pause/resume/recovery + bulk queue controls), folder creation, soft delete, restore, permanent delete, and async media processing (image thumbnails via Sharp, video posters/metadata via FFmpeg/ffprobe).

The app is private and password-gated: one deployment password (bcrypt `ACCESS_PASSWORD_HASH`) unlocks an HttpOnly session cookie, and every private API route enforces it. Every file also gets a permanent shareable URL (`https://barnus.vizitor.hu/f/<slug>`). See `docs/DEPLOYMENT.md` for the exact production setup.

Scripts: `npm run typecheck`, `npm run lint`, `npm run test` (frontend + backend suites), `npm run build`, `npm run backend:build`, and the operational CLIs `backend:migrate`, `backend:status`, `backend:backup`, `backend:restore`, `backend:reconcile`.

See `docs/ARCHITECTURE.md` for the API and lifecycle; `docs/DEPLOYMENT.md` for Ubuntu/FFmpeg setup; `docs/OPERATIONS.md` for the production runbook (service user, systemd, health checks, logs, deployment, rollback); `docs/BACKUP_RESTORE.md` for backup/restore; `docs/shared-files.service.example` for the systemd unit; and `docs/nginx.conf.example` for the reverse proxy. A CI workflow lives at `.github/workflows/ci.yml`.
