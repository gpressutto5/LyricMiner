import type { LyricsResult } from '../../shared/types'

const LRCLIB = 'https://lrclib.net/api'

/** Search LRCLIB directly (it sends permissive CORS headers). One retry on 5xx, which it returns now and then. */
export async function lyricsSearch(p: { q?: string; track?: string; artist?: string }): Promise<LyricsResult[]> {
  const url = new URL(`${LRCLIB}/search`)
  if (p.track) {
    url.searchParams.set('track_name', p.track)
    if (p.artist) url.searchParams.set('artist_name', p.artist)
  } else if (p.q) {
    url.searchParams.set('q', p.q)
  } else {
    return []
  }
  const get = () => fetch(url, { signal: AbortSignal.timeout(10000) })
  let r: Response
  try {
    r = await get()
    if (r.status >= 500) {
      await new Promise((f) => setTimeout(f, 600))
      r = await get()
    }
  } catch (e) {
    throw new Error(`LRCLIB request failed: ${(e as Error).message}`)
  }
  if (!r.ok) throw new Error(`LRCLIB responded ${r.status}. It may be busy, try again in a moment.`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = (await r.json()) as any[]
  return j.slice(0, 25).map((x) => ({
    id: x.id,
    trackName: x.trackName ?? x.name ?? '',
    artistName: x.artistName ?? '',
    albumName: x.albumName ?? '',
    duration: x.duration ?? 0,
    instrumental: !!x.instrumental,
    syncedLyrics: x.syncedLyrics ?? null,
    plainLyrics: x.plainLyrics ?? null,
  }))
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

/** youtube.com search results page for a free-text query (we can't search YouTube from a static site). */
export function youtubeSearchUrl(q: string) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`
}

/**
 * Bookmarklet that sends the YouTube video currently open in the tab to this LyricMiner instance.
 * Built at runtime so it points at whatever origin the site is served from.
 */
export function bookmarkletHref() {
  const target = `${location.origin}${location.pathname}`
  const code = `(()=>{const m=location.href.match(/[?&]v=([\\w-]{11})/)||location.pathname.match(/\\/(?:shorts|embed|live)\\/([\\w-]{11})/);if(m)location.href=${JSON.stringify(target)}+'?v='+m[1];else alert('Open a YouTube video first, then click the bookmarklet.')})()`
  return `javascript:${encodeURIComponent(code)}`
}
