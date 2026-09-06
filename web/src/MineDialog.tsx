import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, X } from 'lucide-react'
import { cn } from 'cn'
import type { TrackInfo } from '../../shared/types'
import type { ToastFn } from './App'
import { addCard, buildSongTag, findLastCard, updateCard, type CardPayload } from './anki'
import { blobToBase64 } from './api'
import type { TabCapture } from './capture'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Kbd } from './components/primitives'
import { formatTime, formatTimeMs } from './lrc'
import type { Settings } from './storage'

export interface MineTarget {
  text: string
  start: number
  end: number
}

interface Props {
  track: TrackInfo
  capture: TabCapture
  target: MineTarget
  settings: Settings
  onClose: () => void
  toast: ToastFn
}

const ms = (t: number) => Math.round(t * 1000)

export function buildFilename(track: TrackInfo, start: number, end: number, ext: string) {
  return `lyricminer_${track.id}_${ms(start)}-${ms(end)}.${ext}`
}

export async function buildPayload(
  track: TrackInfo,
  capture: TabCapture,
  text: string,
  start: number,
  end: number,
  imageTime: number,
  opts: { audio: boolean; image: boolean; sentence: boolean },
  settings: Settings,
): Promise<CardPayload> {
  const payload: CardPayload = { source: `${track.title} (${track.channel})` }
  const songTag = buildSongTag(track, settings.songTagTemplate)
  if (songTag) payload.tags = [songTag]
  if (opts.sentence) payload.sentence = text
  const jobs: Promise<void>[] = []
  if (opts.audio) {
    jobs.push(
      capture
        .clip(start, end)
        .then(blobToBase64)
        .then((data) => {
          payload.audio = { data, filename: buildFilename(track, start, end, 'mp3') }
        }),
    )
  }
  if (opts.image) {
    const frame = capture.frameAt(imageTime)
    if (!frame) throw new Error('No captured frame near that moment. Play through this line once, or turn the image off.')
    jobs.push(
      blobToBase64(frame).then((data) => {
        payload.image = { data, filename: `lyricminer_${track.id}_${ms(imageTime)}.jpg` }
      }),
    )
  }
  await Promise.all(jobs)
  return payload
}

export function MineDialog({ track, capture, target, settings, onClose, toast }: Props) {
  const [text, setText] = useState(target.text)
  const [start, setStart] = useState(Math.max(0, target.start - settings.padStart))
  const [end, setEnd] = useState(Math.min(track.duration || Infinity, target.end + settings.padEnd))
  const [imageTime, setImageTime] = useState((target.start + target.end) / 2)
  const [incAudio, setIncAudio] = useState(true)
  const [incImage, setIncImage] = useState(true)
  const [incSentence, setIncSentence] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewBusy, setPreviewBusy] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const previewUrl = useRef<string | null>(null)

  const dropPreview = () => {
    const a = audioRef.current
    if (a) {
      a.pause()
      a.removeAttribute('src')
      a.load()
    }
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = null
    setPreviewing(false)
  }
  // Trim edits invalidate the preview clip; stop playback so the next preview cuts the new range.
  useEffect(() => {
    dropPreview()
    return dropPreview
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end])

  const captured = capture.has(start, end)
  const frame = useMemo(() => capture.frameAt(imageTime), [capture, imageTime])
  // Object URL lifecycle lives entirely inside the effect so StrictMode's double-invoke can't revoke a live URL.
  const [frameUrl, setFrameUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!frame) {
      setFrameUrl(null)
      return
    }
    const url = URL.createObjectURL(frame)
    setFrameUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [frame])

  const nudge = (which: 'start' | 'end', d: number) => {
    if (which === 'start') setStart((s) => Math.max(0, Math.min(end - 0.1, +(s + d).toFixed(3))))
    else setEnd((e) => Math.max(start + 0.1, Math.min(track.duration || Infinity, +(e + d).toFixed(3))))
  }

  const togglePreview = async () => {
    const a = audioRef.current
    if (!a || previewBusy) return
    if (previewing) {
      a.pause()
      return
    }
    try {
      if (!previewUrl.current) {
        setPreviewBusy(true)
        const blob = await capture.clip(start, end)
        previewUrl.current = URL.createObjectURL(blob)
        a.src = previewUrl.current
      }
      await a.play()
    } catch (e) {
      setPreviewing(false)
      toast((e as Error).message, 'bad')
    } finally {
      setPreviewBusy(false)
    }
  }

  const run = async (mode: 'update' | 'add') => {
    if (busy) return
    setBusy(mode)
    try {
      // Resolve the target before the payload work so a miss fails fast, and so the toast can name the note.
      const target = mode === 'update' ? await findLastCard(settings) : null
      const payload = await buildPayload(track, capture, text, start, end, imageTime, { audio: incAudio, image: incImage, sentence: incSentence }, settings)
      if (target) {
        const r = await updateCard(target, payload, settings)
        toast(`Updated last card${r.word ? ` (${r.word})` : ''}${r.skipped.length ? `. Skipped: ${r.skipped.join(', ')}` : ''}`, 'ok')
      } else {
        const r = await addCard(payload, settings)
        toast(`Added new card${r.skipped.length ? `. Skipped: ${r.skipped.join(', ')}` : ''}`, 'ok')
      }
      onClose()
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setBusy(null)
    }
  }

  const canAdd = !!settings.deck && !!settings.model

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] flex-col gap-5 overflow-y-auto rounded-3xl border-0 p-6 shadow-dialog sm:max-w-[760px]"
        onKeyDown={(e) => {
          const t = e.target as HTMLElement
          if (e.key === 'Enter' && t.tagName !== 'TEXTAREA' && t.tagName !== 'INPUT' && t.tagName !== 'BUTTON') {
            e.preventDefault()
            void run('update')
          }
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <DialogTitle className="text-xl font-extrabold tracking-[-0.3px]">Mine this line</DialogTitle>
            <DialogDescription className="text-[13px] font-medium text-muted">
              <span className="font-jp">{track.track ?? track.title}</span> · {formatTime(target.start)} · Esc to close
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <button type="button" aria-label="Close" className="flex size-9 items-center justify-center rounded-full bg-soft text-ink hover:bg-line-soft">
              <X className="size-3.5" strokeWidth={2.5} />
            </button>
          </DialogClose>
        </div>

        <div className="flex flex-col gap-2.5">
          <IncludeRow checked={incSentence} onChange={setIncSentence} label="Sentence" field={settings.sentenceField} />
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            className={cn(
              'min-h-0 resize-none rounded-[14px] border-0 bg-soft px-[18px] py-3.5 font-jp text-2xl leading-[1.4] font-bold shadow-none transition-opacity focus-visible:ring-coral/30 md:text-2xl',
              !incSentence && 'opacity-40',
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 max-[640px]:grid-cols-1">
          {/* Audio */}
          <div className={cn('flex flex-col gap-3.5 rounded-2xl border border-line p-4 transition-opacity', !incAudio && 'opacity-60')}>
            <IncludeRow checked={incAudio} onChange={setIncAudio} label="Audio" field={settings.audioField} />
            <div className="flex justify-between text-xs font-bold text-muted tabular-nums">
              <span>{formatTimeMs(start)}</span>
              <span className={captured ? 'text-coral-text' : 'text-bad-text'}>{captured ? `${(end - start).toFixed(2)} s` : 'not captured yet'}</span>
              <span>{formatTimeMs(end)}</span>
            </div>
            <div className="flex flex-col gap-2">
              <TrimRow label="Start" value={start} onNudge={(d) => nudge('start', d)} onSet={(v) => setStart(Math.max(0, v))} />
              <TrimRow label="End" value={end} onNudge={(d) => nudge('end', d)} onSet={(v) => setEnd(v)} />
            </div>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => void togglePreview()}
                disabled={!captured || previewBusy}
                className="flex h-9 items-center gap-2 rounded-full bg-ink pr-3.5 pl-2.5 text-[13px] font-bold text-white hover:bg-ink-2 disabled:opacity-40"
              >
                {previewing ? <Pause className="size-3" fill="currentColor" /> : <Play className="size-3" fill="currentColor" />}
                {previewBusy ? 'Cutting…' : previewing ? 'Stop' : 'Preview clip'}
              </button>
              <audio ref={audioRef} preload="none" onPlay={() => setPreviewing(true)} onPause={() => setPreviewing(false)} onEnded={() => setPreviewing(false)} />
              <button
                type="button"
                onClick={() => {
                  setStart(Math.max(0, target.start - settings.padStart))
                  setEnd(target.end + settings.padEnd)
                }}
                className="text-[13px] font-bold text-coral-text hover:text-coral-deep"
              >
                Reset trim
              </button>
            </div>
          </div>

          {/* Image */}
          <div className={cn('flex flex-col gap-3.5 rounded-2xl border border-line p-4 transition-opacity', !incImage && 'opacity-60')}>
            <IncludeRow checked={incImage} onChange={setIncImage} label="Image" field={settings.imageField} />
            {frameUrl ? (
              <img className="aspect-video w-full rounded-xl bg-black object-contain" src={frameUrl} alt="" />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-ink px-4 text-center text-xs font-semibold text-white/70">
                No frame captured near this moment yet
              </div>
            )}
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setImageTime((t) => Math.max(0, t - 1))} className="h-9 rounded-full bg-soft px-3.5 text-[13px] font-bold text-ink-2 hover:bg-line-soft">
                −1 s
              </button>
              <span className="flex-1 text-center text-xs font-semibold text-muted">
                frame at <span className="font-bold text-ink tabular-nums">{formatTimeMs(imageTime)}</span>
              </span>
              <button type="button" onClick={() => setImageTime((t) => t + 1)} className="h-9 rounded-full bg-soft px-3.5 text-[13px] font-bold text-ink-2 hover:bg-line-soft">
                +1 s
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 pt-1">
          <span className="text-[13px] font-medium text-faint">
            {canAdd ? (
              <>
                New cards go to <span className="font-bold text-ink-2">{settings.deck}</span> · <span className="font-bold text-ink-2">{settings.model}</span>
              </>
            ) : (
              'Set a deck and note type in Settings to add brand-new cards.'
            )}
          </span>
          <div className="flex shrink-0 gap-2.5">
            <Button variant="outline" disabled={!!busy || !canAdd} onClick={() => run('add')} className="h-11 rounded-[14px] border-[1.5px] px-[18px] font-bold shadow-none">
              {busy === 'add' ? 'Adding…' : 'Add new card'}
            </Button>
            <Button disabled={!!busy} onClick={() => run('update')} className="h-11 rounded-[14px] px-[18px] font-bold">
              {busy === 'update' ? 'Updating…' : 'Update last card'} <Kbd className="text-white/60">↵</Kbd>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function IncludeRow({ checked, onChange, label, field }: { checked: boolean; onChange: (v: boolean) => void; label: string; field: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5">
      <Switch checked={checked} onCheckedChange={onChange} aria-label={`Include ${label.toLowerCase()}`} />
      <span className="text-[13px] font-bold">{label}</span>
      <span className="text-[13px] font-medium text-faint">→ {field || <span className="italic">no field set</span>}</span>
    </label>
  )
}

function TrimRow({ label, value, onNudge, onSet }: { label: string; value: number; onNudge: (d: number) => void; onSet: (v: number) => void }) {
  const btn = 'flex h-7 items-center rounded-full px-2.5 text-[11px] font-bold text-ink-2 hover:bg-card'
  return (
    <div className="flex items-center gap-2">
      <span className="w-9 text-xs font-bold text-muted">{label}</span>
      <div className="flex h-9 flex-1 items-center rounded-full bg-soft px-1">
        <button type="button" title="−0.5 s" className={cn(btn, 'bg-card')} onClick={() => onNudge(-0.5)}>
          −.5
        </button>
        <button type="button" title="−0.1 s" className={btn} onClick={() => onNudge(-0.1)}>
          −.1
        </button>
        <input
          type="number"
          step={0.05}
          value={value.toFixed(2)}
          onChange={(e) => onSet(Number(e.target.value))}
          aria-label={`${label} time in seconds`}
          className="min-w-0 flex-1 bg-transparent text-center text-[13px] font-bold text-ink tabular-nums outline-none"
        />
        <button type="button" title="+0.1 s" className={btn} onClick={() => onNudge(0.1)}>
          +.1
        </button>
        <button type="button" title="+0.5 s" className={cn(btn, 'bg-card')} onClick={() => onNudge(0.5)}>
          +.5
        </button>
      </div>
    </div>
  )
}
