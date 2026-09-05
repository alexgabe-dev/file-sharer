# Backup & Restore

SQLite and the media filesystem form one logical dataset: every `files` row references an original object and, after processing, a thumbnail. Back them up together.

## Backup

```bash
sudo -u shared-files npm run backend:backup
```

Writes to `BACKUP_ROOT/<timestamp>/`:

```
2026-09-05T120000Z/
  database.sqlite     # safe online backup via SQLite backup API (WAL-aware)
  objects/            # original binaries
  thumbs/             # generated WebP thumbnails/posters
  manifest.json       # timestamp, migration version, app version, counts/sizes
```

Active `upload-sessions/` and `tmp/` are intentionally not backed up (recoverable). `BACKUP_RETENTION_DAYS` (default 7) prunes only directories created under `BACKUP_ROOT`; it never touches the live database/storage or anything outside `BACKUP_ROOT`.

File slugs (`files.slug`) are durable user-facing identifiers and are included in the database backup, so canonical `/f/:slug` links survive restore exactly. `access_sessions` is also included, but session records are not essential content: after restore it is acceptable (and safest) for all sessions to have expired or been revoked — visitors simply enter the shared password again. Use `backend:reconcile --repair` after restore to sweep any stale sessions.

Schedule with a systemd timer or cron, e.g. nightly. For real disaster recovery, also copy backups off-server (no cloud provider is integrated).

## Restore

Restore is explicit, offline, and destructive. Stop the backend first.

```bash
sudo systemctl stop shared-files

# 1. back up the current (possibly broken) state
sudo -u shared-files npm run backend:backup

# 2. validate and restore
sudo -u shared-files npm run backend:restore -- /var/lib/shared-files/backups/<timestamp> --force

# 3. fix ownership if needed
sudo chown -R shared-files:shared-files /var/lib/shared-files

# 4. reconcile and start
sudo -u shared-files npm run backend:reconcile
sudo systemctl start shared-files

# 5. verify
curl -s http://127.0.0.1:3001/health/ready
# then open the frontend and confirm gallery + file delivery + video playback
```

The restore helper requires `--force`, validates the backup `manifest.json` and `database.sqlite`, and refuses to restore a backup whose schema is newer than the running code. It replaces the database (clearing WAL/SHM) and `objects/`+`thumbs/`.

## Reconciliation after restore/incident

`backend:reconcile` detects and reports:

- DB row with missing original binary
- orphan object binary (no DB row)
- missing/dangling thumbnail
- orphan thumbnail
- stuck processing state
- stale/expired upload session
- stale temp file

`--repair` only removes orphaned derived data (thumbnails, expired session chunks, stale temps) and requeues processing. It never deletes original user files.
