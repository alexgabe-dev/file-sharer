import bcrypt from 'bcryptjs'

export type PasswordVerifier = { verify: (plaintext: string) => Promise<boolean> }

/**
 * Verify the single deployment password. Prefer ACCESS_PASSWORD_HASH (bcrypt)
 * in production; ACCESS_PASSWORD (plaintext) is development-only and is hashed
 * once at startup. If neither is configured, verification always fails.
 */
export function createPasswordVerifier(options: { hash?: string; plaintext?: string }): PasswordVerifier {
  let effectiveHash: string | null = null
  if (options.hash) {
    effectiveHash = options.hash
  } else if (options.plaintext) {
    effectiveHash = bcrypt.hashSync(options.plaintext, 10)
  }
  return {
    verify(plaintext: string): Promise<boolean> {
      if (!effectiveHash || plaintext.length === 0) return Promise.resolve(false)
      return bcrypt.compare(plaintext, effectiveHash)
    },
  }
}
