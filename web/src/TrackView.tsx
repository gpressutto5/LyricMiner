import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Circle, ExternalLink, Pause, Play, RotateCcw, SkipBack, SkipForward, Square } from 'lucide-react'
import { cn } from 'cn'
import type { TrackInfo } from '../../shared/types'
import type { ToastFn } from './App'
import { findLastCard, updateCard } from './anki'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { BuyMeACoffee, Card, Kbd, Pill, RoundButton } from './components/primitives'
import { captureSupported, TabCapture, type Coverage } from './capture'
import { formatTime, parseLrc } from './lrc'
import { rememberTrack } from './library'
import { LyricsList } from './LyricsList'
import { LyricsSource } from './LyricsSource'
import { buildPayload, MineDialog, type MineTarget } from './MineDialog'
import { loadLyrics, saveLyrics, type SavedLyrics, type Settings } from './storage'
import { usePlayer, usePlayerTime, type Player } from './usePlayer'
import { fetchOEmbed, YouTubeTransport } from './youtube'

interface Props {
  id: string
  settings: Settings
  onSettings: (s: Settings) => void
  toast: ToastFn
  modalOpen: boolean
}

const RATES = [0.5, 0.75, 0.9, 1, 1.25]
const FONT_MIN = 16
const FONT_MAX = 48

export function TrackView({ id, settings, onSettings, toast, modalOpen }: Props) {
  const [info, setInfo] = useState<TrackInfo | null>(null)
  const [transport, setTransport] = useState<YouTubeTransport | null>(null)
  const [ready, setReady] = useState(false)
  const [playerError, setPlayerError] = useState<string | null>(null)
  const [capture, setCapture] = useState<TabCapture | null>(null)
  const [captureBusy, setCaptureBusy] = useState(false)
  const [saved, setSaved] = useState<SavedLyrics | null>(() => loadLyrics(id))
  const [mineTarget, setMineTarget] = useState<MineTarget | null>(null)
  const [quickBusy, setQuickBusy] = useState(false)
  const playerHost = useRef<HTMLDivElement>(null)
  const playerBox = useRef<HTMLDivElement>(null)

  const lines = useMemo(() => (saved ? parseLrc(saved.lrc, info?.duration) : []), [saved?.lrc, info?.duration])
  const offset = saved?.offset ?? 0

  // Create the YouTube player once per track.
  useEffect(() => {
    const host = playerHost.current
    if (!host) return
    const mount = document.createElement('div')
    host.appendChild(mount)
    const tr = new YouTubeTransport(mount, id)
    setTransport(tr)
    const offReady = tr.on('ready', () => {
      setReady(true)
      setInfo((prev) => (prev ? { ...prev, duration: tr.duration || prev.duration } : prev))
    })
    const offErr = tr.on('error', (msg) => setPlayerError(String(msg)))
    return () => {
      offReady()
      offErr()
      tr.destroy()
      mount.remove()
      setTransport(null)
      setReady(false)
    }
  }, [id])

  // Title / channel from oEmbed; duration arrives from the player.
  useEffect(() => {
    let alive = true
    fetchOEmbed(id)
      .then((o) => {
        if (!alive) return
        setInfo((prev) => ({
          id,
          title: o.title,
          channel: o.author_name,
          duration: prev?.duration ?? 0,
          thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
          url: `https://www.youtube.com/watch?v=${id}`,
          ready: true,
        }))
      })
      .catch((e: Error) => alive && setPlayerError((prev) => prev ?? e.message))
    return () => {
      alive = false
    }
  }, [id])

  useEffect(() => {
    if (info && info.duration) rememberTrack(info)
  }, [info])

  // Dev-only handle for poking at the player and capture from the console / e2e tests.
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __lm?: unknown }).__lm = { transport, capture }
  }, [transport, capture])

  // Stop recording when leaving the track.
  useEffect(() => () => capture?.stop(), [capture])
  useEffect(() => {
    if (!capture) return
    const onStop = () => setCapture(null)
    capture.addEventListener('stop', onStop)
    return () => capture.removeEventListener('stop', onStop)
  }, [capture])

  const changeLyrics = (l: SavedLyrics | null) => {
    setSaved(l)
    saveLyrics(id, l)
  }

  const player = usePlayer({
    transport,
    lines,
    offset,
    keyboardEnabled: !mineTarget && !modalOpen,
    onMine: () => openMine(),
    onQuickUpdate: () => void quickUpdate(),
  })

  const startCapture = async () => {
    if (!transport || captureBusy) return
    setCaptureBusy(true)
    try {
      const c = await TabCapture.start(transport, () => playerBox.current?.getBoundingClientRect() ?? null)
      setCapture(c)
      toast('Capturing. Lines become mineable once you have heard them.', 'ok')
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setCaptureBusy(false)
    }
  }

  /** The line to mine: an explicit index, or the line at (or just before) the playhead. */
  const lineFor = (i?: number) => {
    const idx = i ?? player.currentNav()
    return player.shifted[Math.max(0, idx)]
  }

  const openMine = (i?: number) => {
    if (!capture) return toast('Start capture first so the audio can be clipped.', 'bad')
    const line = lineFor(i)
    if (!line) return toast('No lyric line to mine yet.', 'bad')
    transport?.pause()
    setMineTarget({ text: line.text, start: line.start, end: line.end })
  }
  // Stable identity for the memoized lyrics list; the ref always points at the latest closure.
  const openMineRef = useRef(openMine)
  openMineRef.current = openMine
  const onMineLine = useCallback((i: number) => openMineRef.current(i), [])

  const quickUpdate = async () => {
    if (!info || quickBusy) return
    if (!capture) return toast('Start capture first so the audio can be clipped.', 'bad')
    const line = lineFor()
    if (!line) return toast('No lyric line to mine yet.', 'bad')
    setQuickBusy(true)
    try {
      // Resolve the note first so the toast names what is being overwritten, not just "last card".
      const target = await findLastCard(settings)
      toast(`Updating ${target.word || 'last card'}…`)
      const start = Math.max(0, line.start - settings.padStart)
      const end = line.end + settings.padEnd
      const payload = await buildPayload(info, capture, line.text, start, end, (line.start + line.end) / 2, { audio: true, image: true, sentence: true }, settings)
      const r = await updateCard(target, payload, settings)
      toast(`Updated last card${r.word ? ` (${r.word})` : ''}${r.skipped.length ? `. Skipped: ${r.skipped.join(', ')}` : ''}`, 'ok')
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setQuickBusy(false)
    }
  }

  const duration = player.duration || info?.duration || 0
  const canMine = ready && !!capture && lines.length > 0
  const setFontSize = (d: number) => onSettings({ ...settings, fontSize: Math.max(FONT_MIN, Math.min(FONT_MAX, settings.fontSize + d)) })

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)] gap-5 px-7 pt-2 pb-7 max-[900px]:grid-cols-1 max-[900px]:grid-rows-[auto_minmax(0,1fr)]">
      {/* Player */}
      <div className="flex min-h-0 flex-col items-center gap-2 overflow-y-auto overflow-x-hidden px-0.5 pb-0.5">
        <Card className="flex w-full flex-col gap-4 p-4">
          <div ref={playerBox} className="relative aspect-video overflow-hidden rounded-[14px] bg-black">
            <div ref={playerHost} className="absolute inset-0 [&_iframe]:block [&_iframe]:h-full [&_iframe]:w-full" />
            {/* Keeps clicks (and keyboard focus) out of the iframe; click toggles playback like a <video>. */}
            {ready && !playerError && <button type="button" aria-label="Play / pause" onClick={player.togglePlay} className="absolute inset-0 cursor-pointer" />}
            {!ready && !playerError && (
              <div className="absolute inset-0 flex items-center justify-center bg-ink text-[13px] font-semibold text-white/70">Loading player…</div>
            )}
            {playerError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-ink px-5 text-center text-[13px] font-semibold text-white/70">
                <div className="font-bold text-white">Can't play here</div>
                <div className="text-xs font-medium">{playerError}</div>
                <a href={`https://www.youtube.com/watch?v=${id}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/25">
                  Open on YouTube <ExternalLink className="size-3" />
                </a>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <div className="font-jp text-[17px] leading-[1.3] font-bold">{info?.title ?? '…'}</div>
            <div className="text-[13px] font-medium text-muted">{info?.channel}</div>
          </div>

          <SeekBar player={player} duration={duration} disabled={!ready} capture={capture} />

          <div className="flex items-center justify-center gap-3">
            <RoundButton label="Previous line (←)" onClick={player.prevLine} disabled={!ready}>
              <SkipBack fill="currentColor" />
            </RoundButton>
            <RoundButton label={player.playing ? 'Pause (space)' : 'Play (space)'} size="lg" tone="accent" onClick={player.togglePlay} disabled={!ready}>
              {player.playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" className="translate-x-px" />}
            </RoundButton>
            <RoundButton label="Next line (→)" onClick={player.nextLine} disabled={!ready}>
              <SkipForward fill="currentColor" />
            </RoundButton>
            <RoundButton label="Replay current line (↑)" onClick={player.repeatLine} disabled={!ready}>
              <RotateCcw strokeWidth={2.2} />
            </RoundButton>
          </div>

          <div className="flex items-center gap-2">
            <Pill on={player.autoPause} kbd="A" onClick={() => player.setAutoPause((x) => !x)} title="Pause at the end of every line">
              Auto-pause
            </Pill>
            <Pill on={player.repeat} kbd="R" onClick={() => player.setRepeat((x) => !x)} title="Loop the current line">
              Repeat
            </Pill>
            <div className="flex-1" />
            <Select value={String(player.rate)} onValueChange={(v) => player.setRate(Number(v))}>
              <SelectTrigger aria-label="Playback speed" className="h-9 w-auto gap-1.5 rounded-full border-0 bg-soft px-3 text-[13px] font-bold text-ink-2 shadow-none data-[size=default]:h-9 [&_svg]:text-ink-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end" className="rounded-xl">
                {RATES.map((r) => (
                  <SelectItem key={r} value={String(r)} className="rounded-lg font-semibold">
                    {r}×
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <CaptureRow capture={capture} busy={captureBusy} disabled={!ready} onStart={() => void startCapture()} onStop={() => capture?.stop()} />

          <Button onClick={() => openMine()} disabled={!canMine} className="h-12 w-full rounded-[14px] font-bold" title="Open mining dialog">
            Mine <Kbd className="text-white/60">M</Kbd>
          </Button>
        </Card>

        <BuyMeACoffee />
      </div>

      {/* Lyrics */}
      <Card className="flex min-h-0 flex-col overflow-hidden">
        <LyricsSource
          info={info}
          saved={saved}
          onChange={changeLyrics}
          trailing={
            <div className="flex gap-1.5">
              <button type="button" aria-label="Smaller lyrics" title="Smaller lyrics" onClick={() => setFontSize(-2)} disabled={settings.fontSize <= FONT_MIN} className="flex size-8 items-center justify-center rounded-full bg-soft text-xs font-extrabold text-muted hover:bg-line-soft disabled:opacity-40">
                A
              </button>
              <button type="button" aria-label="Larger lyrics" title="Larger lyrics" onClick={() => setFontSize(2)} disabled={settings.fontSize >= FONT_MAX} className="flex size-8 items-center justify-center rounded-full bg-soft text-base font-extrabold text-muted hover:bg-line-soft disabled:opacity-40">
                A
              </button>
            </div>
          }
        />
        <LyricsList lines={player.shifted} activeIndex={player.activeIndex} fontSize={settings.fontSize} onPlay={player.playLine} onMine={onMineLine} />
        <div className="flex h-11 shrink-0 flex-wrap items-center justify-center gap-x-[18px] border-t border-line-soft text-xs font-semibold text-faint">
          <Shortcut k="← →">lines</Shortcut>
          <Shortcut k="↑">replay</Shortcut>
          <Shortcut k="space">play</Shortcut>
          <Shortcut k="A">auto-pause</Shortcut>
          <Shortcut k="R">repeat</Shortcut>
          <Shortcut k="M">mine</Shortcut>
          <Shortcut k="U">update card</Shortcut>
        </div>
      </Card>

      {mineTarget && info && capture && (
        <MineDialog track={info} capture={capture} target={mineTarget} settings={settings} onClose={() => setMineTarget(null)} toast={toast} />
      )}
    </div>
  )
}

/** Start / stop tab capture, with a hint about what it unlocks. */
function CaptureRow({ capture, busy, disabled, onStart, onStop }: { capture: TabCapture | null; busy: boolean; disabled: boolean; onStart: () => void; onStop: () => void }) {
  if (!captureSupported()) {
    return (
      <div className="rounded-[14px] bg-bad-tint px-4 py-3 text-[13px] font-medium text-bad-text">
        This browser can't capture tab audio, so clips and images can't be mined here. Chrome or Edge can.
      </div>
    )
  }
  return (
    <div className={cn('flex items-center gap-3 rounded-[14px] px-4 py-3', capture ? 'bg-ok-tint' : 'bg-soft')}>
      <span className="relative flex size-2.5 shrink-0 items-center justify-center">
        {capture && <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />}
        <span className={cn('relative inline-flex size-2.5 rounded-full', capture ? 'bg-ok' : 'bg-faint')} />
      </span>
      <span className={cn('min-w-0 flex-1 text-[13px] font-medium', capture ? 'text-ok-text' : 'text-muted')}>
        {capture ? 'Recording this tab. Lines you have heard can be mined.' : 'Share this tab to record audio for mining.'}
      </span>
      {capture ? (
        <button type="button" onClick={onStop} className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-card px-3 text-xs font-bold text-ink hover:bg-line-soft">
          <Square className="size-3" fill="currentColor" /> Stop
        </button>
      ) : (
        <button type="button" onClick={onStart} disabled={disabled || busy} className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-ink px-3 text-xs font-bold text-white hover:bg-ink-2 disabled:opacity-40">
          <Circle className="size-3 text-coral" fill="currentColor" /> {busy ? 'Starting…' : 'Start capture'}
        </button>
      )}
    </div>
  )
}

/** Seek slider + clock + captured ranges. Isolated so the ~12 updates/s playhead ticks only re-render this small subtree. */
function SeekBar({ player, duration, disabled, capture }: { player: Player; duration: number; disabled: boolean; capture: TabCapture | null }) {
  const time = usePlayerTime(player)
  const [coverage, setCoverage] = useState<Coverage[]>([])
  useEffect(() => {
    if (!capture) return setCoverage([])
    const tick = () => setCoverage(capture.coverage())
    tick()
    const i = setInterval(tick, 500)
    return () => clearInterval(i)
  }, [capture])
  return (
    <div className="flex flex-col gap-2">
      <Slider
        min={0}
        max={duration || 1}
        step={0.01}
        value={[Math.min(time, duration || Infinity)]}
        onValueChange={([t]) => player.seekTo(t)}
        disabled={disabled}
        aria-label="Seek"
      />
      <div className="relative h-1 overflow-hidden rounded-full bg-soft" title="Captured audio">
        {duration > 0 &&
          coverage.map((c, i) => (
            <span key={i} className="absolute top-0 h-full bg-ok" style={{ left: `${(c.start / duration) * 100}%`, width: `${((c.end - c.start) / duration) * 100}%` }} />
          ))}
      </div>
      <div className="flex justify-between text-xs font-semibold text-muted tabular-nums">
        <span>{formatTime(time)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  )
}

function Shortcut({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <span>
      <span className="text-ink-2">{k}</span> {children}
    </span>
  )
}
