import { join } from 'node:path'
import { config } from './config'
import { validateConfig } from './config-validation'
import { openDatabase } from './db/database'
import { migrate } from './db/migrate'
import { FileStorage } from './storage/file-storage'
import { availableBytes } from './ops/disk'
import { binaryAvailable } from './media/exec'

async function main() {
  validateConfig(config)
  const db = openDatabase(config.databasePath)
  migrate(db, join(process.cwd(), 'backend/migrations'))
  const storage = new FileStorage(config.storageRoot)

  const latest = db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get() as { version: string } | undefined
  const processing = db.prepare("SELECT COUNT(*) AS n FROM files WHERE deleted_at IS NULL AND status = 'processing'").get() as { n: number }
  const sessions = db.prepare("SELECT COUNT(*) AS n FROM upload_sessions WHERE status IN ('created','uploading','assembling')").get() as { n: number }
  const [ffmpeg, ffprobe] = await Promise.all([binaryAvailable(config.ffmpegPath), binaryAvailable(config.ffprobePath)])

  console.log(JSON.stringify({
    database: { reachable: true, migrationVersion: latest?.version ?? null, path: config.databasePath },
    storage: { writable: storage.probeWritable(), freeBytes: availableBytes(config.storageRoot), path: config.storageRoot },
    media: { ffmpeg: ffmpeg ? 'available' : 'missing', ffprobe: ffprobe ? 'available' : 'missing' },
    jobs: { processingFiles: processing.n, activeUploadSessions: sessions.n },
    version: config.appVersion,
  }, null, 2))
  db.close()
}

main().catch((error) => { console.error(error); process.exit(1) })
