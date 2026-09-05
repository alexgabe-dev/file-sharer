import { join } from 'node:path'
import { config } from './config'
import { validateConfig } from './config-validation'
import { openDatabase } from './db/database'
import { migrate } from './db/migrate'
import { backfillSlugs } from './slug'

validateConfig(config)
const db = openDatabase(config.databasePath)
migrate(db, join(process.cwd(), 'backend/migrations'))
const applied = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: string }>
console.log(`Migrations applied (${applied.length}): ${applied.map((row) => row.version).join(', ') || 'none'}`)
const backfilled = backfillSlugs(db)
if (backfilled > 0) console.log(`Backfilled ${backfilled} file slug(s).`)
db.close()
