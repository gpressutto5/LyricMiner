import type { Health, JobStatus, LyricsResult, SearchResult, TrackInfo } from '../../shared/types'

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((body as { error?: string }).error ?? r.statusText)
  return body as T
}

export interface TrackResponse {
  info: TrackInfo | null
  status: JobStatus
}

export const api = {
  health: () => json<Health>('/api/health'),
  search: (q: string) => json<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`),
  tracks: () => json<TrackInfo[]>('/api/tracks'),
  track: (id: string) => json<TrackResponse>(`/api/tracks/${id}`),
  download: (id: string) => json<TrackResponse>(`/api/tracks/${id}/download`, { method: 'POST' }),
  status: (id: string) => json<TrackResponse>(`/api/tracks/${id}/status`),
  deleteTrack: (id: string) => json<{ ok: boolean }>(`/api/tracks/${id}`, { method: 'DELETE' }),
  lyricsSearch: (p: { q?: string; track?: string; artist?: string }) => {
    const qs = new URLSearchParams()
    if (p.track) qs.set('track', p.track)
    if (p.artist) qs.set('artist', p.artist)
    if (p.q) qs.set('q', p.q)
    return json<LyricsResult[]>(`/api/lyrics/search?${qs}`)
  },
  mediaUrl: (id: string) => `/api/media/${id}`,
  clipUrl: (id: string, start: number, end: number) =>
    `/api/clip?id=${id}&start=${start.toFixed(3)}&end=${end.toFixed(3)}`,
  frameUrl: (id: string, t: number) => `/api/frame?id=${id}&t=${t.toFixed(3)}`,
}

/** Fetch a binary URL and return its base64 payload (no data: prefix), as AnkiConnect expects. */
export async function fetchBase64(url: string): Promise<string> {
  const r = await fetch(url)
  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `Failed to fetch ${url}`)
  }
  const blob = await r.blob()
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
