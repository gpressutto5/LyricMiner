import type { Transport, TransportEvent } from './transport'

/* Minimal typings for the parts of the IFrame Player API we use. */
interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  seekTo(s: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  setPlaybackRate(r: number): void
  getPlaybackRate(): number
  getVideoData(): { title: string; author: string; video_id: string }
  destroy(): void
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer
  PlayerState: { UNSTARTED: -1; ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5 }
}
declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<YTNamespace> | null = null

/** Load https://www.youtube.com/iframe_api once and resolve with the YT namespace. */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT)
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      if (window.YT) resolve(window.YT)
    }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.async = true
    s.onerror = () => reject(new Error('Could not load the YouTube player. Check your connection or an ad blocker.'))
    document.head.appendChild(s)
  })
  return apiPromise
}

export const EMBED_ERRORS: Record<number, string> = {
  2: 'Invalid video id.',
  5: 'This video cannot be played in the embedded player.',
  100: 'Video not found. It may be private or removed.',
  101: 'The owner of this video does not allow it to be played outside YouTube.',
  150: 'The owner of this video does not allow it to be played outside YouTube.',
}

const PLAYING = 1
const BUFFERING = 3
const ENDED = 0

/**
 * Wraps a YouTube IFrame player as a Transport.
 *
 * The IFrame API only reports the playhead a few times per second, so `currentTime` is
 * interpolated from the last report using wall-clock time while the video is playing.
 */
export class YouTubeTransport implements Transport {
  private player: YTPlayer | null = null
  private listeners = new Map<TransportEvent, Set<(detail?: unknown) => void>>()
  private lastReported = 0
  private reportedAt = 0
  private state = -1
  private _rate = 1
  private _duration = 0
  private destroyed = false
  /** Rate we were asked for before the player was ready. */
  private pendingRate: number | null = null
  /** When a seek on a not-yet-started player kicked off playback by itself (see seek()). */
  private seekStartedAt = 0

  ready = false
  error: string | null = null

  constructor(el: HTMLElement, videoId: string) {
    void loadYouTubeApi()
      .then((YT) => {
        if (this.destroyed) return
        this.player = new YT.Player(el, {
          videoId,
          width: '100%',
          height: '100%',
          host: 'https://www.youtube-nocookie.com',
          playerVars: {
            controls: 0,
            disablekb: 1,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            modestbranding: 1,
            origin: location.origin,
          },
          events: {
            onReady: () => {
              if (!this.player) return
              this.ready = true
              this._duration = this.player.getDuration() || 0
              if (this.pendingRate !== null) this.player.setPlaybackRate(this.pendingRate)
              this.emit('ready')
            },
            onStateChange: (e: { data: number }) => {
              const prev = this.state
              this.state = e.data
              this.sample(true)
              if (!this._duration && this.player) this._duration = this.player.getDuration() || 0
              if (e.data === PLAYING && prev !== PLAYING) this.emit('play')
              else if (e.data === ENDED) this.emit('ended')
              else if (prev === PLAYING && e.data !== PLAYING && e.data !== BUFFERING) this.emit('pause')
            },
            onPlaybackRateChange: (e: { data: number }) => {
              this._rate = e.data
              this.sample(true)
            },
            onError: (e: { data: number }) => {
              this.error = EMBED_ERRORS[e.data] ?? `YouTube player error ${e.data}.`
              this.emit('error', this.error)
            },
          },
        })
      })
      .catch((e: Error) => {
        this.error = e.message
        this.emit('error', this.error)
      })
  }

  /** Refresh the playhead anchor from the player. Returns true when the reported value changed. */
  private sample(force = false): boolean {
    if (!this.player || !this.ready) return false
    const t = this.player.getCurrentTime()
    if (force || t !== this.lastReported) {
      this.lastReported = t
      this.reportedAt = performance.now()
      return true
    }
    return false
  }

  get currentTime(): number {
    this.sample()
    if (this.state !== PLAYING) return this.lastReported
    // Interpolate, but never run more than a second past the last report (buffering, tab throttled...).
    const dt = Math.min(1, (performance.now() - this.reportedAt) / 1000) * this._rate
    return this.lastReported + dt
  }

  get duration(): number {
    return this._duration
  }

  get paused(): boolean {
    return this.state !== PLAYING && this.state !== BUFFERING
  }

  get rate(): number {
    return this._rate
  }

  get title(): string {
    return this.player?.getVideoData?.().title ?? ''
  }

  get author(): string {
    return this.player?.getVideoData?.().author ?? ''
  }

  play() {
    // seekTo() on an unstarted player already starts playback at the target; calling playVideo()
    // right after makes YouTube restart from 0, so skip it while that seek is settling.
    if (this.seekStartedAt && performance.now() - this.seekStartedAt < 1500 && (this.state === -1 || this.state === 5)) return
    this.player?.playVideo()
  }

  pause() {
    this.player?.pauseVideo()
  }

  seek(t: number) {
    if (!this.player) return
    if (this.state === -1 || this.state === 5) this.seekStartedAt = performance.now()
    this.player.seekTo(t, true)
    // Treat the target as the new anchor right away so the UI doesn't snap back for a frame.
    this.lastReported = t
    this.reportedAt = performance.now()
  }

  setRate(r: number) {
    this._rate = r
    if (this.player && this.ready) this.player.setPlaybackRate(r)
    else this.pendingRate = r
  }

  on(event: TransportEvent, fn: (detail?: unknown) => void): () => void {
    let set = this.listeners.get(event)
    if (!set) this.listeners.set(event, (set = new Set()))
    set.add(fn)
    return () => set!.delete(fn)
  }

  private emit(event: TransportEvent, detail?: unknown) {
    this.listeners.get(event)?.forEach((fn) => fn(detail))
  }

  destroy() {
    this.destroyed = true
    this.listeners.clear()
    try {
      this.player?.destroy()
    } catch {
      /* already gone */
    }
    this.player = null
  }
}

export interface OEmbed {
  title: string
  author_name: string
  thumbnail_url: string
}

/** Public, CORS-enabled metadata for a video: title, channel, thumbnail. */
export async function fetchOEmbed(id: string): Promise<OEmbed> {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error(r.status === 404 || r.status === 401 ? 'Video not found or not embeddable.' : `YouTube responded ${r.status}.`)
  return (await r.json()) as OEmbed
}

const thumbCache = new Map<string, Promise<string>>()

/**
 * The largest still YouTube serves for a video. maxresdefault only exists for some uploads (a miss is a
 * 404, which the browser reports as an image error), so probe it and fall back to hqdefault, which always
 * exists. Used as the card image when no frame free of the embed's glyph has been captured.
 */
export function bestThumbnail(id: string): Promise<string> {
  let p = thumbCache.get(id)
  if (!p) {
    const maxres = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`
    p = new Promise<string>((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img.naturalWidth > 120 ? maxres : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`)
      img.onerror = () => resolve(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`)
      img.src = maxres
    })
    thumbCache.set(id, p)
  }
  return p
}
