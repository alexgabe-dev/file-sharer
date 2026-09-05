import { randomUUID } from 'node:crypto'
import { config } from './config'
import { openDatabase } from './db/database'
import { migrate } from './db/migrate'
import { join } from 'node:path'
const db = openDatabase(config.databasePath); migrate(db, join(process.cwd(), 'backend/migrations'))
const token = 'dev-shared-space'; const now = new Date().toISOString(); const existing = db.prepare('SELECT public_token FROM shared_spaces WHERE public_token = ?').get(token)
if (!existing) { const spaceId = randomUUID(); db.prepare('INSERT INTO shared_spaces VALUES (?, ?, ?, ?, ?)').run(spaceId, token, 'Development Shared Files', now, now); for (const name of ['Design references', 'Projects', 'Personal']) db.prepare('INSERT INTO folders (id, public_id, space_id, name, created_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), randomUUID(), spaceId, name, now) }
console.log(`Development shared URL: http://localhost:3000/s/${token}`)
