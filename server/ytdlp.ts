import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

let cached: string | null | undefined

/** Locate a yt-dlp binary: env override, common system paths, then the one bundled by youtube-dl-exec. */
export function ytdlpPath(): string | null {
  if (cached !== undefined) return cached
  const candidates: string[] = []
  if (process.env.YTDLP_PATH) candidates.push(process.env.YTDLP_PATH)
  candidates.push(
    '/opt/homebrew/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    path.join(process.env.HOME ?? '', '.local/bin/yt-dlp'),
  )
  try {
    const require = createRequire(import.meta.url)
    const constants = require('youtube-dl-exec').constants
    if (constants?.YOUTUBE_DL_PATH) candidates.push(constants.YOUTUBE_DL_PATH)
    if (constants?.YOUTUBE_DL_DIR) candidates.push(path.join(constants.YOUTUBE_DL_DIR, 'yt-dlp'))
  } catch {
    /* package not installed */
  }
  cached = candidates.find((p) => p && fs.existsSync(p)) ?? null
  return cached
}

export interface RunResult {
  stdout: string
  stderr: string
  code: number
}

/** Spawn a process, optionally streaming stdout lines to a callback. */
export function run(cmd: string, args: string[], onLine?: (line: string) => void): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args)
    let stdout = ''
    let stderr = ''
    let buf = ''
    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString()
      stdout += s
      if (onLine) {
        buf += s
        const parts = buf.split('\n')
        buf = parts.pop() ?? ''
        parts.forEach(onLine)
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (onLine && buf) onLine(buf)
      resolve({ stdout, stderr, code: code ?? -1 })
    })
  })
}
