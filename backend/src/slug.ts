import { randomInt } from 'node:crypto'
import type Database from 'better-sqlite3'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function randomSuffix(length = 6): string {
  let out = ''
  for (let i = 0; i < length; i += 1) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}

/** Normalize a filename into a URL-safe slug base (lowercase, hyphen-separated, extension-stripped). */
export function slugify(name: string): string {
  const trimmed = name.trim()
  const withoutExtension = trimmed.replace(/\.[A-Za-z0-9]{1,5}$/, '')
  const base = withoutExtension
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return base || 'file'
}

/** Generate a unique slug with a filename prefix plus random entropy, retrying on collision. */
export function generateSlug(name: string, exists: (slug: string) => boolean): string {
  const base = slugify(name)
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `${base}-${randomSuffix(6)}`
    if (!exists(candidate)) return candidate
  }
  return `${base}-${randomSuffix(12)}`
}

/** Backfill slugs for existing files (idempotent). Returns the number backfilled. */
export function backfillSlugs(db: Database.Database): number {
  const rows = db.prepare('SELECT id, original_name FROM files WHERE slug IS NULL OR slug = ?').all('') as Array<{ id: string; original_name: string }>
  let count = 0
  for (const row of rows) {
    const slug = generateSlug(row.original_name, (candidate) => Boolean(db.prepare('SELECT 1 FROM files WHERE slug = ?').get(candidate)))
    db.prepare('UPDATE files SET slug = ? WHERE id = ?').run(slug, row.id)
    count += 1
  }
  return count
}
