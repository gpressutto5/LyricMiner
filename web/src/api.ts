import type { Health, LyricsResult, SearchResult } from '../../shared/types'

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((body as { error?: string }).error ?? r.statusText)
  return body as T
}

export const api = {
  health: () => json<Health>('/api/health'),
  search: (q: string) => json<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`),
  lyricsSearch: (p: { q?: string; track?: string; artist?: string }) => {
    const qs = new URLSearchParams()
    if (p.track) qs.set('track', p.track)
    if (p.artist) qs.set('artist', p.artist)
    if (p.q) qs.set('q', p.q)
    return json<LyricsResult[]>(`/api/lyrics/search?${qs}`)
  },
}

/** Base64 payload (no data: prefix) of a blob, as AnkiConnect expects. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '')
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(blob)
  })
}

/** Extract a YouTube video id from a URL or bare id, or null if the text is a plain search query. */
export function parseYouTubeId(text: string): string | null {
  const s = text.trim()
  if (/^[\w-]{11}$/.test(s)) return s
  try {
    const u = new URL(s)
    if (u.hostname === 'youtu.be') return u.pathname.slice(1, 12) || null
    if (u.hostname.endsWith('youtube.com')) {
      const v = u.searchParams.get('v')
      if (v) return v
      const m = u.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/)
      if (m) return m[1]
    }
  } catch {
    /* not a URL */
  }
  return null
}
