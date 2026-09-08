import { encodeMp3 } from './mp3'
import type { Transport } from './transport'

/**
 * A stretch of uninterrupted playback at normal speed: wall-clock time and player time advance
 * together, so any player time inside it maps to a fixed offset in the recording.
 */
interface Run {
  /** performance.now() and player time at the first sample. */
  wall0: number
  t0: number
  /** Latest sample. */
  wall1: number
  t1: number
  rate: number
  /** Running mean of (reported - predicted); corrects a slightly late/early first anchor. */
  bias: number
  n: number
}

export interface Coverage {
  start: number
  end: number
}

interface Frame {
  t: number
  /** Wall clock (performance.now()) when the frame was grabbed. */
  wall: number
  blob: Blob
  /** Grabbed while the embed was flashing its play/pause glyph over the video (see CHROME_MS). */
  dirty: boolean
  /** The glyph was detected in the pixels (as opposed to assumed from timing). */
  glyph: boolean
}

const SAMPLE_MS = 100
const FRAME_MS = 500
const MAX_DRIFT = 0.35
const MAX_FRAMES = 1500
const FRAME_WIDTH = 640
const PEAK_TARGET = 0.95
const MAX_GAIN = 4
/**
 * How long YouTube paints its own chrome after a play or a seek: the embed shows its controls, including a
 * big play/pause glyph in the middle of the video that no cropping can hide, and only autohides them after
 * about 4.5 s with no further activity (measured Sep 2026; `controls=0` makes no difference). Frames grabbed
 * inside that window are kept (they may be all we have) but only used when nothing cleaner is close enough.
 */
const CHROME_MS = 4500
/**
 * The glyph is a dark disc about this many CSS pixels across, centred on the video, with a white play or
 * pause icon inside. Frames are checked for it directly; the timing rules above are only a backstop.
 */
const GLYPH_DIAMETER_CSS = 68
/**
 * The transport only learns it is paused when the embed posts a state change back, some hundreds of ms
 * after the request, and the glyph is already up by then. When a pause is first seen, frames grabbed this
 * far back are marked dirty after the fact.
 */
const PAUSE_LAG_MS = 1000
/**
 * Recorded audio consistently lands ~55 ms later in the recording than the player-time mapping predicts
 * (measured against ffmpeg cuts of the same video across several runs), so shift the window by that much.
 */
const CAPTURE_LATENCY = 0.055
/** Start the replay at least this far before the requested window so the first sample lands before it. */
const REPLAY_LEAD = 0.6
/** How early to start a clean-frame replay: the glyph window plus room for the seek to buffer. */
const CLEAN_AFTER_MS = CHROME_MS + 1500
/** Extra wall-clock slack for the replay (seek, buffering) before giving up. */
const REPLAY_SLACK_MS = 8000

/**
 * Does this frame have the embed's play/pause glyph on it? The glyph is a neutral dark disc centred on the
 * video with a white icon in the middle, so look for mostly-dark, low-saturation pixels in a ring where the
 * disc is and a fair share of near-white pixels in its centre. `scale` converts CSS pixels to frame pixels.
 * Video content can imitate that, but a false positive only costs a frame; a miss puts a glyph on a card.
 */
export function hasGlyph(ctx: CanvasRenderingContext2D, w: number, h: number, scale: number): boolean {
  const R = (GLYPH_DIAMETER_CSS / 2) * scale
  const cx = w / 2
  const cy = h / 2
  const size = Math.ceil(R * 2) + 2
  const x0 = Math.max(0, Math.round(cx - R - 1))
  const y0 = Math.max(0, Math.round(cy - R - 1))
  if (x0 + size > w || y0 + size > h) return false
  const { data } = ctx.getImageData(x0, y0, size, size)
  let ring = 0
  let ringDark = 0
  let core = 0
  let coreWhite = 0
  const step = Math.max(1, Math.round(R / 24))
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const dx = x0 + x - cx
      const dy = y0 + y - cy
      const d = Math.hypot(dx, dy) / R
      if (d > 0.92) continue
      const i = (y * size + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const hi = Math.max(r, g, b)
      const lo = Math.min(r, g, b)
      if (d >= 0.55) {
        ring++
        if (hi < 165 && hi - lo < 80) ringDark++
      } else if (d <= 0.4) {
        core++
        if (lo > 195 && hi - lo < 45) coreWhite++
      }
    }
  }
  return ring > 0 && core > 0 && ringDark / ring > 0.6 && coreWhite / core > 0.12
}

export function captureSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== 'undefined'
}

/**
 * Records the current tab's audio (and periodic video frames of the player area) while the
 * user listens, keeping a map from player time to recording time so any line that has been
 * heard once can be clipped afterwards.
 */
export class TabCapture extends EventTarget {
  private stream: MediaStream
  private recorder: MediaRecorder
  private chunks: Blob[] = []
  private recStart = 0
  private runs: Run[] = []
  private frames: Frame[] = []
  private video: HTMLVideoElement | null = null
  private canvas = document.createElement('canvas')
  private timer = 0
  private lastFrameAt = 0
  /** performance.now() until which grabbed frames are assumed to have the embed's glyph on them. */
  private chromeUntil = 0
  private grabbing = false
  /** When a grabbed frame last had the embed's glyph on it (dev diagnostics). */
  lastGlyphAt = 0
  private wasPaused = true
  /** When a replay asked the player to pause; frames before that instant are known to be glyph-free. */
  private pauseRequestedAt: number | null = null
  /** Frames grabbed inside this wall-time span are dirty even if they looked clean when taken (see smudgeSince). */
  private smudge: { from: number; to: number } | null = null
  private decoded: { size: number; buffer: AudioBuffer } | null = null
  private pendingData: (() => void)[] = []
  private recording: Promise<void> | null = null
  stopped = false

  private constructor(
    stream: MediaStream,
    private transport: Transport,
    private getRect: () => DOMRect | null,
    /** Suspend line-stepping behaviour (auto-pause, repeat) while a replay runs; returns the release function. */
    private hold: () => () => void,
  ) {
    super()
    this.stream = stream
    const audioTracks = stream.getAudioTracks()
    if (!audioTracks.length) {
      stream.getTracks().forEach((t) => t.stop())
      throw new Error('No tab audio was shared. Tick "Share tab audio" in the dialog and try again.')
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m))
    this.recorder = new MediaRecorder(new MediaStream(audioTracks), mime ? { mimeType: mime, audioBitsPerSecond: 128000 } : undefined)
    this.recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data)
      const waiters = this.pendingData
      this.pendingData = []
      waiters.forEach((w) => w())
    }
    this.recorder.onstart = () => {
      this.recStart = performance.now()
    }
    this.recorder.start(1000)

    const videoTrack = stream.getVideoTracks()[0]
    if (videoTrack) {
      const v = document.createElement('video')
      v.muted = true
      v.playsInline = true
      v.srcObject = new MediaStream([videoTrack])
      void v.play().catch(() => {})
      this.video = v
    }
    stream.getTracks().forEach((t) => t.addEventListener('ended', () => this.stop()))
    this.timer = window.setInterval(() => this.tick(), SAMPLE_MS)
  }

  /** Ask the browser to share this tab (user gesture required) and start recording. */
  static async start(transport: Transport, getRect: () => DOMRect | null, hold: () => () => void = () => () => {}): Promise<TabCapture> {
    if (!captureSupported()) throw new Error('This browser cannot capture tab audio. Use Chrome or Edge.')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        // Chromium-only hints: preselect this tab, allow sharing it, keep system audio out.
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        systemAudio: 'exclude',
        surfaceSwitching: 'exclude',
      } as DisplayMediaStreamOptions)
    } catch (e) {
      const err = e as DOMException
      if (err.name === 'NotAllowedError') throw new Error('Tab sharing was cancelled.')
      throw new Error(`Could not start capture: ${err.message}`)
    }
    return new TabCapture(stream, transport, getRect, hold)
  }

  private tick() {
    if (this.stopped) return
    const tr = this.transport
    const now = performance.now()
    if (tr.paused) {
      // Pausing paints the glyph, and it lingers into the first frames after playback resumes.
      this.chromeUntil = now + CHROME_MS
      // A user pause is only noticed once the embed reports it, so reach back over the lag; our own pauses
      // are timestamped, and smudging further back would eat the clean frame a replay just waited for.
      if (!this.wasPaused) this.smudgeSince(this.pauseRequestedAt ?? now - PAUSE_LAG_MS)
      this.pauseRequestedAt = null
      this.wasPaused = true
      return
    }
    this.wasPaused = false
    const t = tr.currentTime
    const rate = tr.rate
    const last = this.runs[this.runs.length - 1]
    if (last && last.rate === rate && now - last.wall1 < SAMPLE_MS * 5) {
      const predicted = last.t0 + ((now - last.wall0) / 1000) * rate
      const drift = t - predicted
      if (Math.abs(drift - last.bias) < MAX_DRIFT) {
        last.wall1 = now
        last.t1 = t
        last.n++
        last.bias += (drift - last.bias) / last.n
        this.maybeGrabFrame(t, now)
        return
      }
    }
    // A fresh run means the playhead jumped (a seek) or the rate changed, both of which show the glyph. While
    // the embed buffers after a seek the playhead does not move at all, which also breaks the run; that is
    // not new activity, so it must not push the glyph deadline out further.
    if (!last || last.rate !== rate || Math.abs(t - last.t1) > MAX_DRIFT) this.chromeUntil = now + CHROME_MS
    this.runs.push({ wall0: now, t0: t, wall1: now, t1: t, rate, bias: 0, n: 1 })
    this.maybeGrabFrame(t, now)
  }

  /**
   * Frames grabbed from `wall` up to now were taken under the glyph without knowing it; demote them. The span
   * is remembered so a frame whose JPEG encode is still in flight gets demoted when it lands, but it must
   * not extend into the future or every later frame would be dirty too.
   */
  private smudgeSince(wall: number) {
    this.smudge = { from: wall, to: performance.now() }
    for (const f of this.frames) if (f.wall >= wall) f.dirty = true
  }

  private maybeGrabFrame(t: number, now: number) {
    if (!this.video || this.grabbing || now - this.lastFrameAt < FRAME_MS) return
    const rect = this.getRect()
    const v = this.video
    if (!rect || !v.videoWidth || rect.width < 10) return
    this.lastFrameAt = now
    // The captured surface is the tab's viewport; map CSS pixels to captured pixels. Inset a little so the
    // player's rounded corners / card border don't end up in the card image.
    const sx = v.videoWidth / window.innerWidth
    const sy = v.videoHeight / window.innerHeight
    const inset = 3
    const srcX = (rect.left + inset) * sx
    const srcY = (rect.top + inset) * sy
    const srcW = (rect.width - inset * 2) * sx
    const srcH = (rect.height - inset * 2) * sy
    const w = Math.round(Math.min(FRAME_WIDTH, srcW))
    const h = Math.round((srcH / srcW) * w)
    this.canvas.width = w
    this.canvas.height = h
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(v, srcX, srcY, srcW, srcH, 0, 0, w, h)
    // Look for the glyph in the pixels themselves; the timing rule is a backstop for when that misses.
    const glyph = hasGlyph(ctx, w, h, w / (rect.width - inset * 2))
    if (glyph) this.lastGlyphAt = now
    const dirty = glyph || now < this.chromeUntil
    this.grabbing = true
    this.canvas.toBlob(
      (blob) => {
        this.grabbing = false
        if (!blob) return
        // A smudge may have landed while the encode was in flight.
        const smudged = !!this.smudge && now >= this.smudge.from && now <= this.smudge.to
        this.frames.push({ t, wall: now, blob, dirty: dirty || smudged, glyph })
        if (this.frames.length > MAX_FRAMES) this.frames.splice(0, this.frames.length - MAX_FRAMES)
      },
      'image/jpeg',
      0.85,
    )
  }

  /** Player-time ranges recorded at normal speed, merged and sorted. */
  coverage(): Coverage[] {
    const spans = this.runs
      .filter((r) => r.rate === 1 && r.t1 - r.t0 > 0.2)
      .map((r) => ({ start: r.t0, end: r.t1 }))
      .sort((a, b) => a.start - b.start)
    const out: Coverage[] = []
    for (const s of spans) {
      const last = out[out.length - 1]
      if (last && s.start <= last.end + 0.05) last.end = Math.max(last.end, s.end)
      else out.push({ ...s })
    }
    return out
  }

  /** The run (at 1x) that contains the whole [start, end] window, if any. */
  private runFor(start: number, end: number): Run | null {
    // Prefer the most recent matching run: it is what the user just heard.
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const r = this.runs[i]
      if (r.rate !== 1) continue
      const lo = r.t0 + r.bias
      const hi = r.t1 + r.bias
      if (start >= lo - 0.05 && end <= hi + 0.05) return r
    }
    return null
  }

  has(start: number, end: number): boolean {
    return !!this.runFor(start, end)
  }

  /**
   * Make sure [start, end] is in the recording: when it is not, replay it once at normal speed
   * (the user hears the line again), then put the playhead back where it was.
   */
  /**
   * Make sure [start, end] has been recorded, replaying it if not. With `cleanFrameAt`, the replay instead
   * starts CHROME_MS early and runs until a frame free of the embed's glyph exists near that moment; that is
   * several seconds of playback, so callers only ask for it when the user chose a real frame over the
   * video thumbnail.
   */
  async ensure(start: number, end: number, cleanFrameAt?: number): Promise<void> {
    const frameAt = cleanFrameAt
    const done = () => this.has(start, end) && (frameAt === undefined || this.hasCleanFrame(frameAt))
    if (done()) return
    if (this.recording) {
      await this.recording
      if (done()) return
    }
    this.recording = this.replay(start, end, frameAt).finally(() => {
      this.recording = null
    })
    return this.recording
  }

  /** True while a replay-to-record is in progress. */
  get isRecording() {
    return !!this.recording
  }

  private async replay(start: number, end: number, frameAt?: number): Promise<void> {
    if (this.stopped) throw new Error('Capture has stopped. Start it again to mine.')
    const tr = this.transport
    const resumeAt = tr.currentTime
    const wasPlaying = !tr.paused
    const prevRate = tr.rate
    const release = this.hold()
    const replayStart = performance.now()
    let from = start
    this.dispatchEvent(new Event('recording'))
    try {
      if (prevRate !== 1) tr.setRate(1)
      // The seek and play show the glyph for CHROME_MS. Start far enough ahead that the wanted frame is
      // grabbed after it hides, so the picture is of the line rather than of the glyph. This is the whole
      // reason a replay for an image runs several seconds long; audio alone needs only REPLAY_LEAD.
      let lead = REPLAY_LEAD
      if (frameAt !== undefined) lead = Math.max(lead, CLEAN_AFTER_MS / 1000 - (frameAt - start))
      from = Math.max(0, start - lead)
      tr.seek(from)
      tr.play()
      const wanted = () => this.has(start, end) && (frameAt === undefined || this.hasCleanFrame(frameAt))
      // Allow for running on past the line: a clean frame may only turn up within a second after `frameAt`.
      const until = Math.max(end, frameAt === undefined ? end : frameAt + 1)
      const deadline = performance.now() + (until - from) * 1000 + REPLAY_SLACK_MS
      while (!wanted()) {
        if (this.stopped) throw new Error('Capture stopped during the replay.')
        if (performance.now() > deadline) {
          if (this.has(start, end)) break // Audio is in; settle for whatever frame there is.
          throw new Error('Could not record this line: playback did not reach the end of it. Try again.')
        }
        // The moment we wanted a picture of has gone by with the glyph still up (a slow seek, usually).
        // Waiting longer cannot help, since frames further on are not of that moment.
        if (frameAt !== undefined && this.has(start, end) && tr.currentTime > frameAt + 1.3) {
          throw new Error("YouTube's play/pause overlay was still showing when that moment went by. Try “Record frame” again.")
        }
        await new Promise((r) => setTimeout(r, SAMPLE_MS))
      }
    } finally {
      if (import.meta.env.DEV && frameAt !== undefined) this.debugFrames(frameAt, from, replayStart)
      this.pauseRequestedAt = performance.now()
      tr.pause()
      if (prevRate !== 1) tr.setRate(prevRate)
      tr.seek(resumeAt)
      if (wasPlaying) tr.play()
      release()
      this.dispatchEvent(new Event('recorded'))
    }
  }

  /** Flush the recorder so the chunk list includes everything up to now. */
  private async flush(): Promise<void> {
    if (this.recorder.state !== 'recording') return
    await new Promise<void>((resolve) => {
      this.pendingData.push(resolve)
      this.recorder.requestData()
    })
  }

  private async decodeAll(): Promise<AudioBuffer> {
    await this.flush()
    const blob = new Blob(this.chunks, { type: this.recorder.mimeType || 'audio/webm' })
    if (this.decoded && this.decoded.size === blob.size) return this.decoded.buffer
    const ctx = new OfflineAudioContext(1, 1, 48000)
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
    this.decoded = { size: blob.size, buffer }
    return buffer
  }

  /** Cut [start, end] (player seconds) out of the recording and encode it as MP3. */
  async clip(start: number, end: number): Promise<Blob> {
    await this.ensure(start, end)
    const run = this.runFor(start, end)
    if (!run) throw new Error('This part of the song has not been captured yet. Play through it once at normal speed.')
    const buffer = await this.decodeAll()
    const recOffset = (run.wall0 - this.recStart) / 1000
    const from = recOffset + (start - (run.t0 + run.bias)) + CAPTURE_LATENCY
    const to = recOffset + (end - (run.t0 + run.bias)) + CAPTURE_LATENCY
    const sr = buffer.sampleRate
    const i0 = Math.max(0, Math.floor(from * sr))
    const i1 = Math.min(buffer.length, Math.ceil(to * sr))
    if (i1 - i0 < sr * 0.1) throw new Error('The captured audio for this line is too short. Try replaying it.')
    const mono = new Float32Array(i1 - i0)
    const chans = buffer.numberOfChannels
    for (let c = 0; c < chans; c++) {
      const data = buffer.getChannelData(c)
      for (let i = 0; i < mono.length; i++) mono[i] += data[i0 + i] / chans
    }
    // YouTube plays most music several dB below full scale (loudness normalisation), so bring the
    // peak back up. Capped so a near-silent stretch doesn't become noise.
    let peak = 0
    for (let i = 0; i < mono.length; i++) peak = Math.max(peak, Math.abs(mono[i]))
    const gain = Math.min(PEAK_TARGET / (peak || 1), MAX_GAIN)
    if (gain > 1) for (let i = 0; i < mono.length; i++) mono[i] *= gain
    return encodeMp3(mono, sr)
  }

  /**
   * Nearest frame to t grabbed clear of the embed's glyph, or null when none is within a second. Frames
   * caught under the glyph are never returned: the video thumbnail makes a better card image than a play
   * button pasted over the singer.
   */
  /** Dev only: what the frame store looks like around `t` after a clean-frame replay, to diagnose "no clean frame". */
  private debugFrames(t: number, from: number, replayStart: number) {
    const near = this.frames.filter((f) => f.wall >= replayStart).map((f) => ({
      t: +f.t.toFixed(2),
      dt: +(f.t - t).toFixed(2),
      wall: +((f.wall - replayStart) / 1000).toFixed(2),
      dirty: f.dirty,
      glyph: f.glyph,
    }))
    console.info(
      `[capture] clean-frame replay: want t=${t.toFixed(2)} from=${from.toFixed(2)} chromeUntil=+${((this.chromeUntil - replayStart) / 1000).toFixed(2)}s ` +
        `glyphLastSeen=${this.lastGlyphAt ? `+${((this.lastGlyphAt - replayStart) / 1000).toFixed(2)}s` : 'never'} clean=${this.hasCleanFrame(t)} runs=${this.runs.length}`,
    )
    console.table(near)
  }

  /** True when a frame within a second of t was grabbed clear of the glyph. */
  hasCleanFrame(t: number): boolean {
    return this.frameAt(t) !== null
  }

  frameAt(t: number): Blob | null {
    let best: Frame | null = null
    for (const f of this.frames) {
      if (f.dirty || Math.abs(f.t - t) > 1) continue
      if (!best || Math.abs(f.t - t) < Math.abs(best.t - t)) best = f
    }
    return best?.blob ?? null
  }

  get frameCount() {
    return this.frames.length
  }

  stop() {
    if (this.stopped) return
    this.stopped = true
    clearInterval(this.timer)
    try {
      if (this.recorder.state !== 'inactive') this.recorder.stop()
    } catch {
      /* ignore */
    }
    this.stream.getTracks().forEach((t) => t.stop())
    if (this.video) {
      this.video.srcObject = null
      this.video = null
    }
    this.dispatchEvent(new Event('stop'))
  }
}
