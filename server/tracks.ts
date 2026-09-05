import fs from 'node:fs'
import path from 'node:path'
import type { JobStatus, SearchResult, TrackInfo } from '../shared/types'
import { run, ytdlpPath } from './ytdlp'

export const CACHE_DIR = path.resolve(process.env.LYRICMINER_CACHE ?? 'cache')
fs.mkdirSync(CACHE_DIR, { recursive: true })

const MEDIA_EXT = ['mp4', 'webm', 'mkv', 'm4a', 'opus', 'ogg', 'mp3']
export const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  m4a: 'audio/mp4',
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
}

export const ID_RE = /^[\w-]{6,20}$/

export function findMediaFile(id: string): string | null {
  for (const ext of MEDIA_EXT) {
    const p = path.join(CACHE_DIR, `${id}.${ext}`)
    if (fs.existsSync(p)) return p
  }
  return null
}

function infoPath(id: string) {
  return path.join(CACHE_DIR, `${id}.info.json`)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTrackInfo(j: any): TrackInfo {
  return {
    id: j.id,
    title: j.title ?? '',
    channel: j.channel ?? j.uploader ?? '',
    track: j.track ?? undefined,
    artist: j.artist ?? j.creator ?? undefined,
    album: j.album ?? undefined,
    duration: typeof j.duration === 'number' ? j.duration : 0,
    thumbnail: `https://i.ytimg.com/vi/${j.id}/mqdefault.jpg`,
    url: j.webpage_url ?? `https://www.youtube.com/watch?v=${j.id}`,
    ready: !!findMediaFile(j.id),
  }
}

export function readInfo(id: string): TrackInfo | null {
  const p = infoPath(id)
  if (!fs.existsSync(p)) return null
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (j.formats || j.thumbnails || j.automatic_captions) {
      // yt-dlp's info json is huge; keep only what we use.
      const slim = {
        id: j.id,
        title: j.title,
        channel: j.channel ?? j.uploader,
        track: j.track,
        artist: j.artist ?? j.creator,
        album: j.album,
        duration: j.duration,
        webpage_url: j.webpage_url,
        upload_date: j.upload_date,
      }
      fs.writeFileSync(p, JSON.stringify(slim))
    }
    return toTrackInfo(j)
  } catch {
    return null
  }
}

export function listTracks(): TrackInfo[] {
  const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.info.json'))
  const out: { info: TrackInfo; mtime: number }[] = []
  for (const f of files) {
    const id = f.replace(/\.info\.json$/, '')
    const media = findMediaFile(id)
    if (!media) continue
    const info = readInfo(id)
    if (info) out.push({ info, mtime: fs.statSync(media).mtimeMs })
  }
  return out.sort((a, b) => b.mtime - a.mtime).map((x) => x.info)
}

export function deleteTrack(id: string) {
  for (const f of fs.readdirSync(CACHE_DIR)) {
    if (f.startsWith(`${id}.`)) fs.rmSync(path.join(CACHE_DIR, f), { force: true })
  }
  jobs.delete(id)
}

const jobs = new Map<string, JobStatus>()

export function getStatus(id: string): JobStatus {
  if (findMediaFile(id)) return { state: 'ready', progress: 100, phase: 'ready' }
  return jobs.get(id) ?? { state: 'idle', progress: 0, phase: '' }
}

export function startDownload(id: string): JobStatus {
  if (findMediaFile(id)) return getStatus(id)
  const existing = jobs.get(id)
  if (existing?.state === 'downloading') return existing

  const bin = ytdlpPath()
  if (!bin) {
    const s: JobStatus = { state: 'error', progress: 0, phase: '', error: 'yt-dlp binary not found' }
    jobs.set(id, s)
    return s
  }

  const status: JobStatus = { state: 'downloading', progress: 0, phase: 'starting' }
  jobs.set(id, status)

  const args = [
    `https://www.youtube.com/watch?v=${id}`,
    '-f', 'bv*+ba/b',
    // Prefer <=480p H.264 + AAC so the browser can play the file and ffmpeg seeks are quick.
    '-S', 'res:480,vcodec:h264,acodec:aac',
    '--merge-output-format', 'mp4',
    '--remux-video', 'mp4',
    '--write-info-json',
    '--no-playlist',
    '--no-warnings',
    '--newline',
    '-o', path.join(CACHE_DIR, '%(id)s.%(ext)s'),
  ]

  run(bin, args, (line) => {
    const m = line.match(/\[download\]\s+([\d.]+)%/)
    if (m) {
      status.progress = parseFloat(m[1])
      status.phase = 'downloading'
    } else if (line.startsWith('[Merger]')) {
      status.phase = 'merging'
      status.progress = 100
    } else if (line.startsWith('[VideoRemuxer]')) {
      status.phase = 'remuxing'
      status.progress = 100
    }
  })
    .then((r) => {
      if (r.code === 0 && findMediaFile(id)) {
        status.state = 'ready'
        status.progress = 100
        status.phase = 'ready'
      } else {
        status.state = 'error'
        const lines = r.stderr.trim().split('\n').filter(Boolean)
        status.error = lines[lines.length - 1] ?? 'download failed'
      }
    })
    .catch((e) => {
      status.state = 'error'
      status.error = String(e)
    })

  return status
}

export async function search(q: string): Promise<SearchResult[]> {
  const bin = ytdlpPath()
  if (!bin) throw new Error('yt-dlp binary not found')
  const r = await run(bin, [`ytsearch12:${q}`, '--dump-single-json', '--flat-playlist', '--no-warnings'])
  if (r.code !== 0) {
    const lines = r.stderr.trim().split('\n').filter(Boolean)
    throw new Error(lines[lines.length - 1] ?? 'search failed')
  }
  const j = JSON.parse(r.stdout)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (j.entries ?? [])
    .filter((e: any) => e?.id)
    .map((e: any) => ({
      id: e.id,
      title: e.title ?? '',
      channel: e.channel ?? e.uploader ?? '',
      duration: typeof e.duration === 'number' ? e.duration : null,
      thumbnail: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
    }))
}
