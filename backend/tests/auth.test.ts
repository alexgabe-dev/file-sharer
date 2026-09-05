import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildServer } from '../src/server'
import { openDatabase } from '../src/db/database'
import { migrate } from '../src/db/migrate'
import { createSession, hashToken } from '../src/auth/sessions'

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'auth-'))
  const databasePath = join(root, 'test.db')
  const db = openDatabase(databasePath)
  migrate(db, join(process.cwd(), 'backend/migrations'))
  const now = new Date().toISOString()
  const spaceId = randomUUID()
  db.prepare('INSERT INTO shared_spaces VALUES (?, ?, ?, ?, ?)').run(spaceId, 'test-token', 'Test', now, now)
  db.close()
  const app = buildServer({ databasePath, storageRoot: root, frontendOrigins: ['https://frontend.example'], logLevel: 'silent', accessPassword: 'test-password', authRateLimitMax: 3, authRateLimitWindowMs: 60000 })
  return { app, root, databasePath, spaceId }
}

function cookieHeader(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'] as string | string[] | undefined
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  return list.map((cookie) => cookie.split(';')[0]).join('; ')
}

function csrfToken(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'] as string | string[] | undefined
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  const csrf = list.find((cookie) => cookie.startsWith('barnus_csrf='))
  return csrf ? csrf.split(';')[0].slice('barnus_csrf='.length) : ''
}

async function login(app: ReturnType<typeof buildServer>, password: string) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { password }, headers: { origin: 'https://frontend.example' } })
}

test('login sets a session cookie and session endpoint reports authenticated', async () => {
  const { app } = setup()
  await app.ready()
  const response = await login(app, 'test-password')
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().authenticated, true)
  const cookies = cookieHeader(response)
  assert.ok(cookies.includes('barnus_session='))

  const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: cookies } })
  assert.equal(session.json().authenticated, true)
  await app.close()
})

test('invalid password is rejected generically', async () => {
  const { app } = setup()
  await app.ready()
  const response = await login(app, 'wrong-password')
  assert.equal(response.statusCode, 401)
  assert.equal(response.json().error.code, 'INVALID_PASSWORD')
  await app.close()
})

test('login is rate limited', async () => {
  const { app } = setup()
  await app.ready()
  for (let i = 0; i < 3; i += 1) await login(app, 'wrong')
  const limited = await login(app, 'wrong')
  assert.equal(limited.statusCode, 429)
  await app.close()
})

test('protected routes require a valid session cookie', async () => {
  const { app } = setup()
  await app.ready()

  const missing = await app.inject({ method: 'GET', url: '/api/v1/spaces/test-token/files' })
  assert.equal(missing.statusCode, 401)

  const invalid = await app.inject({ method: 'GET', url: '/api/v1/spaces/test-token/files', headers: { cookie: 'barnus_session=bogus' } })
  assert.equal(invalid.statusCode, 401)

  const loginResponse = await login(app, 'test-password')
  const ok = await app.inject({ method: 'GET', url: '/api/v1/spaces/test-token/files', headers: { cookie: cookieHeader(loginResponse) } })
  assert.equal(ok.statusCode, 200)
  await app.close()
})

test('logout revokes the session', async () => {
  const { app } = setup()
  await app.ready()
  const loginResponse = await login(app, 'test-password')
  const cookies = cookieHeader(loginResponse)
  await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: cookies } })
  const after = await app.inject({ method: 'GET', url: '/api/v1/spaces/test-token/files', headers: { cookie: cookies } })
  assert.equal(after.statusCode, 401)
  await app.close()
})

test('state-changing requests require a matching CSRF token', async () => {
  const { app } = setup()
  await app.ready()
  const loginResponse = await login(app, 'test-password')
  const cookies = cookieHeader(loginResponse)
  const csrf = csrfToken(loginResponse)

  const noCsrf = await app.inject({ method: 'POST', url: '/api/v1/spaces/test-token/folders', headers: { cookie: cookies }, payload: { name: 'Folder' } })
  assert.equal(noCsrf.statusCode, 403)

  const withCsrf = await app.inject({ method: 'POST', url: '/api/v1/spaces/test-token/folders', headers: { cookie: cookies, 'x-csrf-token': csrf }, payload: { name: 'Folder' } })
  assert.equal(withCsrf.statusCode, 201)
  await app.close()
})

test('expired and revoked sessions are rejected', async () => {
  const { app, databasePath } = setup()
  await app.ready()

  const db = openDatabase(databasePath)
  const now = new Date().toISOString()
  const expiredToken = 'expired-token-value'
  const revokedToken = 'revoked-token-value'
  createSession(db, hashToken(expiredToken), new Date(Date.now() - 1000).toISOString(), now)
  createSession(db, hashToken(revokedToken), new Date(Date.now() + 60000).toISOString(), now)
  db.prepare('UPDATE access_sessions SET revoked_at = ? WHERE token_hash = ?').run(now, hashToken(revokedToken))
  db.close()

  const expired = await app.inject({ method: 'GET', url: '/api/v1/spaces/test-token/files', headers: { cookie: `barnus_session=${expiredToken}` } })
  assert.equal(expired.statusCode, 401)
  const revoked = await app.inject({ method: 'GET', url: '/api/v1/spaces/test-token/files', headers: { cookie: `barnus_session=${revokedToken}` } })
  assert.equal(revoked.statusCode, 401)
  await app.close()
})

