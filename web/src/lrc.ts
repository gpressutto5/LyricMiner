export interface LyricLine {
  start: number
  end: number
  text: string
}

const TS = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const WORD_TS = /<\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?>/g
const OFFSET = /\[offset:\s*([+-]?\d+)\]/i

/**
 * Parse LRC text into lines with start/end times.
 * Empty timestamped lines are dropped from the output but still terminate the preceding line,
 * so instrumental gaps stay silent instead of extending the previous lyric.
 */
export function parseLrc(lrc: string, totalDuration?: number): LyricLine[] {
  const offMatch = lrc.match(OFFSET)
  const fileOffset = offMatch ? Number(offMatch[1]) / 1000 : 0

  const raw: { t: number; text: string }[] = []
  for (const line of lrc.split(/\r?\n/)) {
    const stamps = [...line.matchAll(TS)]
    if (!stamps.length) continue
    const text = line.replace(TS, '').replace(WORD_TS, '').trim()
    for (const m of stamps) {
      const frac = m[3] ? Number(m[3].padEnd(3, '0')) / 1000 : 0
      const t = Number(m[1]) * 60 + Number(m[2]) + frac + fileOffset
      raw.push({ t: Math.max(0, t), text })
    }
  }
  raw.sort((a, b) => a.t - b.t)

  // Merge lines that share the exact same timestamp (duets etc.).
  const merged: { t: number; text: string }[] = []
  for (const r of raw) {
    const last = merged[merged.length - 1]
    if (last && Math.abs(last.t - r.t) < 0.001) {
      last.text = [last.text, r.text].filter(Boolean).join(' / ')
    } else {
      merged.push({ ...r })
    }
  }

  const lines: LyricLine[] = []
  for (let i = 0; i < merged.length; i++) {
    const cur = merged[i]
    if (!cur.text) continue
    const next = merged[i + 1]
    let end = next ? next.t : totalDuration && totalDuration > cur.t ? totalDuration : cur.t + 5
    if (end - cur.t < 0.3) end = cur.t + 0.3
    lines.push({ start: cur.t, end, text: cur.text })
  }
  return lines
}

export function formatTime(t: number): string {
  if (!Number.isFinite(t)) return '0:00'
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatTimeMs(t: number): string {
  const m = Math.floor(t / 60)
  const s = (t % 60).toFixed(2).padStart(5, '0')
  return `${m}:${s}`
}
