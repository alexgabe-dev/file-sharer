import { spawn } from 'node:child_process'

export type ExecResult = { code: number; stdout: string; stderr: string }

export class ExecTimeoutError extends Error {
  constructor(message: string) { super(message); this.name = 'ExecTimeoutError' }
}

const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024

/**
 * Run an external binary with an argument array (never a shell string) and
 * enforce a hard timeout plus bounded output capture so a pathological or
 * hostile media file cannot exhaust the VPS.
 */
export function runBinary(
  binary: string,
  args: string[],
  options: { timeoutMs?: number; maxOutputBytes?: number } = {},
): Promise<ExecResult> {
  const { timeoutMs = 120_000, maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES } = options
  return new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })

    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let stdoutTruncated = false
    let stderrTruncated = false
    let settled = false

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new ExecTimeoutError(`${binary} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (!stdoutTruncated) {
        if (stdoutBytes > maxOutputBytes) { stdoutTruncated = true } else { stdout += chunk.toString('utf8') }
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (!stderrTruncated) {
        if (stderrBytes > maxOutputBytes) { stderrTruncated = true } else { stderr += chunk.toString('utf8') }
      }
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

/** True when the binary exists on PATH; used to fail gracefully up front. */
export function binaryAvailable(binary: string): Promise<boolean> {
  return runBinary(binary, ['-version'], { timeoutMs: 5000 })
    .then(() => true)
    .catch(() => false)
}
