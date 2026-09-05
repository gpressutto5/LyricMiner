import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  ID_RE,
  MIME,
  deleteTrack,
  findMediaFile,
  getStatus,
  listTracks,
  readInfo,
  search,
  startDownload,
} from './tracks'
import { ytdlpPath } from './ytdlp'

const PORT = Number(process.env.LYRICMINER_PORT ?? 8787)
const ANKI_URL = process.env.ANKI_CONNECT_URL ?? 'http://127.0.0.1:8765'
const LRCLIB = 'https://lrclib.net/api'
const UA = 'LyricMiner/0.1 (local lyrics study tool)'

const app = express()
app.use(express.json({ limit: '2mb' }))

function hasFfmpeg() {
  try {
    return spawnSync('ffmpeg', ['-version']).status === 0
  } catch {
    return false
  }
}

async function ankiAlive() {
  try {
    const r = await fetch(ANKI_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'version', version: 6 }),
      signal: AbortSignal.timeout(1000),
    })
    return r.ok
  } catch {
    return false
  }
}

app.get('/api/health', async (_req, res) => {
  res.json({ ytdlp: ytdlpPath(), ffmpeg: hasFfmpeg(), anki: await ankiAlive() })
})

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  if (!q) return res.status(400).json({ error: 'missing q' })
  try {
    res.json(await search(q))
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.get('/api/tracks', (_req, res) => {
  res.json(listTracks())
})

app.param('id', (req, res, next, id) => {
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'bad id' })
  next()
})

app.get('/api/tracks/:id', (req, res) => {
  const id = req.params.id as string
  res.json({ info: readInfo(id), status: getStatus(id) })
})

app.post('/api/tracks/:id/download', (req, res) => {
  const id = req.params.id as string
  const status = startDownload(id)
  res.json({ info: readInfo(id), status })
})

app.get('/api/tracks/:id/status', (req, res) => {
  const id = req.params.id as string
  res.json({ info: readInfo(id), status: getStatus(id) })
})

app.delete('/api/tracks/:id', (req, res) => {
  deleteTrack(req.params.id as string)
  res.json({ ok: true })
})

app.get('/api/media/:id', (req, res) => {
  const file = findMediaFile(req.params.id as string)
  if (!file) return res.status(404).json({ error: 'media not ready' })
  const ext = path.extname(file).slice(1)
  res.sendFile(file, { headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream' } })
})

app.get('/api/lyrics/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  const track = String(req.query.track ?? '').trim()
  const artist = String(req.query.artist ?? '').trim()
  if (!q && !track) return res.status(400).json({ error: 'missing query' })
  const url = new URL(`${LRCLIB}/search`)
  if (track) {
    url.searchParams.set('track_name', track)
    if (artist) url.searchParams.set('artist_name', artist)
  } else {
    url.searchParams.set('q', q)
  }
  try {
    let r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })
    if (r.status >= 500) {
      // LRCLIB occasionally 503s on full-text searches; one retry usually succeeds.
      await new Promise((f) => setTimeout(f, 600))
      r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })
    }
    if (!r.ok) return res.status(502).json({ error: `LRCLIB responded . It may be busy, try again in a moment.` })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = (await r.json()) as any[]
    res.json(
      j.slice(0, 25).map((x) => ({
        id: x.id,
        trackName: x.trackName ?? x.name ?? '',
        artistName: x.artistName ?? '',
        albumName: x.albumName ?? '',
        duration: x.duration ?? 0,
        instrumental: !!x.instrumental,
        syncedLyrics: x.syncedLyrics ?? null,
        plainLyrics: x.plainLyrics ?? null,
      })),
    )
  } catch (e) {
    res.status(502).json({ error: `LRCLIB request failed: ${(e as Error).message}` })
  }
})

/** Trim the track's audio to [start, end] and stream it back as MP3. */
app.get('/api/clip', (req, res) => {
  const id = String(req.query.id ?? '')
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'bad id' })
  const file = findMediaFile(id)
  if (!file) return res.status(404).json({ error: 'media not ready' })
  const start = Math.max(0, parseFloat(String(req.query.start)))
  const end = parseFloat(String(req.query.end))
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return res.status(400).json({ error: 'bad range' })
  }
  const ff = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-ss', start.toFixed(3),
    '-t', (end - start).toFixed(3),
    '-i', file,
    '-vn',
    '-c:a', 'libmp3lame', '-q:a', '3',
    '-f', 'mp3', 'pipe:1',
  ])
  res.setHeader('Content-Type', 'audio/mpeg')
  res.setHeader('Cache-Control', 'no-store')
  let err = ''
  ff.stderr.on('data', (d: Buffer) => (err += d.toString()))
  ff.stdout.pipe(res)
  ff.on('close', (code) => {
    if (code !== 0 && !res.headersSent) res.status(500).json({ error: err || 'ffmpeg failed' })
  })
  req.on('close', () => ff.kill())
})

/** Grab a still frame at time t (falls back to the YouTube thumbnail for audio-only media). */
app.get('/api/frame', (req, res) => {
  const id = String(req.query.id ?? '')
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'bad id' })
  const file = findMediaFile(id)
  if (!file) return res.status(404).json({ error: 'media not ready' })
  const t = Math.max(0, parseFloat(String(req.query.t ?? '0')) || 0)

  const sendThumb = async () => {
    try {
      const r = await fetch(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, { signal: AbortSignal.timeout(8000) })
      const buf = Buffer.from(await r.arrayBuffer())
      res.type('image/jpeg').send(buf)
    } catch {
      res.status(500).json({ error: 'could not produce an image' })
    }
  }

  const chunks: Buffer[] = []
  const ff = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-ss', t.toFixed(3),
    '-i', file,
    '-frames:v', '1',
    '-vf', "scale='min(640,iw)':-2",
    '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '3',
    'pipe:1',
  ])
  ff.stdout.on('data', (c: Buffer) => chunks.push(c))
  ff.on('error', () => void sendThumb())
  ff.on('close', (code) => {
    const buf = Buffer.concat(chunks)
    if (code === 0 && buf.length > 0) {
      res.setHeader('Cache-Control', 'no-store')
      res.type('image/jpeg').send(buf)
    } else {
      void sendThumb()
    }
  })
})

/** Proxy to AnkiConnect so the browser never has to deal with its CORS allow-list. */
app.post('/api/anki', async (req, res) => {
  try {
    const r = await fetch(ANKI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(30000),
    })
    res.status(r.status).type('application/json').send(await r.text())
  } catch {
    res.status(502).json({
      result: null,
      error: 'AnkiConnect is not reachable. Is Anki running with the AnkiConnect add-on installed?',
    })
  }
})

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
  if (fs.existsSync(dist)) {
    app.use(express.static(dist))
    app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')))
  }
}

app.listen(PORT, () => {
  console.log(`LyricMiner server on http://localhost:${PORT}`)
  console.log(`  yt-dlp: ${ytdlpPath() ?? 'NOT FOUND'}  ffmpeg: ${hasFfmpeg() ? 'ok' : 'NOT FOUND'}`)
})
