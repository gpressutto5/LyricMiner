import { useEffect, useRef, useState } from 'react'
import { Pause, Play, X } from 'lucide-react'
import { cn } from 'cn'
import type { TrackInfo } from '../../shared/types'
import type { ToastFn } from './App'
import { addCard, buildSongTag, updateLastCard, type CardPayload } from './anki'
import { api, fetchBase64 } from './api'
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
      fetchBase64(api.clipUrl(track.id, start, end)).then((data) => {
        payload.audio = { data, filename: buildFilename(track, start, end, 'mp3') }
      }),
    )
  }
  if (opts.image) {
    jobs.push(
      fetchBase64(api.frameUrl(track.id, imageTime)).then((data) => {
        payload.image = { data, filename: `lyricminer_${track.id}_${ms(imageTime)}.jpg` }
      }),
    )
  }
  await Promise.all(jobs)
  return payload
}

export function MineDialog({ track, target, settings, onClose, toast }: Props) {
  const [text, setText] = useState(target.text)
  const [start, setStart] = useState(Math.max(0, target.start - settings.padStart))
  const [end, setEnd] = useState(Math.min(track.duration || Infinity, target.end + settings.padEnd))
  const [imageTime, setImageTime] = useState((target.start + target.end) / 2)
  const [incAudio, setIncAudio] = useState(true)
  const [incImage, setIncImage] = useState(true)
  const [incSentence, setIncSentence] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)

  // Trim edits invalidate the preview clip; stop playback so the next preview fetches the new range.
  useEffect(() => {
    const a = audioRef.current
    if (a) {
      a.pause()
      a.removeAttribute('src')
      a.load()
    }
    setPreviewing(false)
  }, [start, end])

  const nudge = (which: 'start' | 'end', d: number) => {
    if (which === 'start') setStart((s) => Math.max(0, Math.min(end - 0.1, +(s + d).toFixed(3))))
    else setEnd((e) => Math.max(start + 0.1, Math.min(track.duration || Infinity, +(e + d).toFixed(3))))
  }

  const togglePreview = () => {
    const a = audioRef.current
    if (!a) return
    if (previewing) {
      a.pause()
      return
    }
    if (!a.getAttribute('src')) a.src = api.clipUrl(track.id, start, end)
    void a.play().catch(() => setPreviewing(false))
  }

  const run = async (mode: 'update' | 'add') => {
    if (busy) return
    setBusy(mode)
    try {
      const payload = await buildPayload(track, text, start, end, imageTime, { audio: incAudio, image: incImage, sentence: incSentence }, settings)
      if (mode === 'update') {
        const r = await updateLastCard(payload, settings)
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
              <span className="text-coral-text">{(end - start).toFixed(2)} s</span>
              <span>{formatTimeMs(end)}</span>
            </div>
            <div className="flex flex-col gap-2">
              <TrimRow label="Start" value={start} onNudge={(d) => nudge('start', d)} onSet={(v) => setStart(Math.max(0, v))} />
              <TrimRow label="End" value={end} onNudge={(d) => nudge('end', d)} onSet={(v) => setEnd(v)} />
            </div>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={togglePreview}
                className="flex h-9 items-center gap-2 rounded-full bg-ink pr-3.5 pl-2.5 text-[13px] font-bold text-white hover:bg-ink-2"
              >
                {previewing ? <Pause className="size-3" fill="currentColor" /> : <Play className="size-3" fill="currentColor" />}
                {previewing ? 'Stop' : 'Preview clip'}
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
            <img className="aspect-video w-full rounded-xl bg-black object-contain" src={api.frameUrl(track.id, imageTime)} alt="" />
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
