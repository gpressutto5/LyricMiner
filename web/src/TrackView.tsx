import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react'
import type { JobStatus, TrackInfo } from '../../shared/types'
import type { ToastFn } from './App'
import { updateLastCard } from './anki'
import { api } from './api'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Card, Kbd, Pill, RoundButton } from './components/primitives'
import { formatTime, parseLrc } from './lrc'
import { LyricsList } from './LyricsList'
import { LyricsSource } from './LyricsSource'
import { buildPayload, MineDialog, type MineTarget } from './MineDialog'
import { loadLyrics, saveLyrics, type SavedLyrics, type Settings } from './storage'
import { usePlayer, usePlayerTime, type Player } from './usePlayer'

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
  const [status, setStatus] = useState<JobStatus>({ state: 'idle', progress: 0, phase: '' })
  const [saved, setSaved] = useState<SavedLyrics | null>(() => loadLyrics(id))
  const [mineTarget, setMineTarget] = useState<MineTarget | null>(null)
  const [quickBusy, setQuickBusy] = useState(false)

  const lines = useMemo(() => (saved ? parseLrc(saved.lrc, info?.duration) : []), [saved?.lrc, info?.duration])
  const offset = saved?.offset ?? 0

  // Kick off (or resume) the download and poll until the media is ready.
  useEffect(() => {
    let alive = true
    let timer = 0
    const apply = (r: { info: TrackInfo | null; status: JobStatus }) => {
      if (!alive) return
      setStatus(r.status)
      if (r.info) setInfo(r.info)
      if (r.status.state === 'downloading' || r.status.state === 'idle') {
        timer = window.setTimeout(() => api.status(id).then(apply).catch(fail), 700)
      }
    }
    const fail = (e: Error) => alive && setStatus({ state: 'error', progress: 0, phase: '', error: e.message })
    api.download(id).then(apply).catch(fail)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [id])

  const changeLyrics = (l: SavedLyrics | null) => {
    setSaved(l)
    saveLyrics(id, l)
  }

  const player = usePlayer({
    lines,
    offset,
    keyboardEnabled: !mineTarget && !modalOpen,
    onMine: () => openMine(),
    onQuickUpdate: () => void quickUpdate(),
  })

  /** The line to mine: an explicit index, or the line at (or just before) the playhead. */
  const lineFor = (i?: number) => {
    const idx = i ?? player.currentNav()
    return player.shifted[Math.max(0, idx)]
  }

  const openMine = (i?: number) => {
    const line = lineFor(i)
    if (!line) return toast('No lyric line to mine yet.', 'bad')
    player.videoRef.current?.pause()
    setMineTarget({ text: line.text, start: line.start, end: line.end })
  }
  // Stable identity for the memoized lyrics list; the ref always points at the latest closure.
  const openMineRef = useRef(openMine)
  openMineRef.current = openMine
  const onMineLine = useCallback((i: number) => openMineRef.current(i), [])

  const quickUpdate = async () => {
    if (!info || quickBusy) return
    const line = lineFor()
    if (!line) return toast('No lyric line to mine yet.', 'bad')
    setQuickBusy(true)
    toast('Updating last card…')
    try {
      const start = Math.max(0, line.start - settings.padStart)
      const end = line.end + settings.padEnd
      const payload = await buildPayload(info, line.text, start, end, (line.start + line.end) / 2, { audio: true, image: true, sentence: true }, settings)
      const r = await updateLastCard(payload, settings)
      toast(`Updated last card${r.word ? ` (${r.word})` : ''}${r.skipped.length ? `. Skipped: ${r.skipped.join(', ')}` : ''}`, 'ok')
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setQuickBusy(false)
    }
  }

  const ready = status.state === 'ready'
  const duration = player.duration || info?.duration || 0
  const setFontSize = (d: number) => onSettings({ ...settings, fontSize: Math.max(FONT_MIN, Math.min(FONT_MAX, settings.fontSize + d)) })

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)] gap-5 px-7 pt-2 pb-7 max-[900px]:grid-cols-1 max-[900px]:grid-rows-[auto_minmax(0,1fr)]">
      {/* Player */}
      <Card className="flex flex-col gap-4 self-start p-4">
        <div className="relative aspect-video overflow-hidden rounded-[14px] bg-black">
          {ready && <video ref={player.videoRef} src={api.mediaUrl(id)} playsInline className="block h-full w-full" {...player.videoProps} />}
          {!ready && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-ink text-[13px] font-semibold text-white/70">
              {status.state === 'error' ? (
                <>
                  <div className="font-bold text-white">Download failed</div>
                  <div className="px-4 text-center text-xs font-medium">{status.error}</div>
                  <Button size="sm" variant="secondary" className="mt-1 rounded-full font-bold" onClick={() => api.download(id).then((r) => setStatus(r.status))}>
                    Retry
                  </Button>
                </>
              ) : (
                <>
                  <div>{status.phase === 'merging' || status.phase === 'remuxing' ? 'Finishing up…' : 'Downloading…'}</div>
                  <div className="h-1.5 w-[60%] overflow-hidden rounded-full bg-white/15">
                    <div className="h-full rounded-full bg-coral transition-[width]" style={{ width: `${status.progress}%` }} />
                  </div>
                  <div className="text-xs tabular-nums">{status.progress.toFixed(0)}%</div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <div className="font-jp text-[17px] leading-[1.3] font-bold">{info?.title ?? '…'}</div>
          <div className="text-[13px] font-medium text-muted">{info?.channel}</div>
        </div>

        <SeekBar player={player} duration={duration} disabled={!ready} />

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

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-2.5">
          <Button variant="outline" onClick={() => openMine()} disabled={!ready || !lines.length} className="h-12 rounded-[14px] border-[1.5px] font-bold shadow-none" title="Open mining dialog">
            Mine… <Kbd>M</Kbd>
          </Button>
          <Button onClick={() => void quickUpdate()} disabled={!ready || !lines.length || quickBusy} className="h-12 rounded-[14px] font-bold" title="Update last Anki card with this line">
            {quickBusy ? 'Updating…' : 'Update last card'} <Kbd className="text-white/60">U</Kbd>
          </Button>
        </div>
      </Card>

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

      {mineTarget && info && (
        <MineDialog track={info} target={mineTarget} settings={settings} onClose={() => setMineTarget(null)} toast={toast} />
      )}
    </div>
  )
}

/** Seek slider + clock. Isolated so the ~12 updates/s playhead ticks only re-render this small subtree. */
function SeekBar({ player, duration, disabled }: { player: Player; duration: number; disabled: boolean }) {
  const time = usePlayerTime(player)
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
