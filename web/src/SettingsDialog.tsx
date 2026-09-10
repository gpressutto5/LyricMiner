import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from 'cn'
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui'
import { buildSongTag, invoke, UPDATE_WINDOW_MS } from './anki'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { SectionLabel, StatusChip, Stepper } from './components/primitives'
import { DEFAULT_SETTINGS, type AutoDetectAction, type Settings } from './storage'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: Settings
  onChange: (s: Settings) => void
}

const fieldClass =
  'h-10 rounded-xl border border-line bg-card px-3 text-sm font-semibold text-ink shadow-none placeholder:font-medium placeholder:text-faint focus-visible:border-coral focus-visible:ring-[3px] focus-visible:ring-coral/20 md:text-sm'
const selectClass = cn(fieldClass, 'w-full data-[size=default]:h-10 disabled:opacity-50 [&_svg]:text-faint')

/** Sample track for the per-song tag preview, so the template's effect is visible while typing. */
const SAMPLE_TRACK = {
  title: 'ヒッチコック',
  track: "The Hitchhiker's Guide",
  artist: 'ヨルシカ Yorushika',
  album: 'だから僕は音楽を辞めた',
  channel: 'ヨルシカ / n-buna Official',
}

/**
 * Settings, laid out as a list: every row is a title and a one-line hint on the left with its control on the
 * right, so the explanation sits next to the thing it explains instead of in a paragraph after the group.
 */
export function SettingsDialog({ open, onOpenChange, settings, onChange }: Props) {
  const [decks, setDecks] = useState<string[]>([])
  const [models, setModels] = useState<string[]>([])
  const [fields, setFields] = useState<string[]>([])
  const [ankiError, setAnkiError] = useState<string | null | undefined>(undefined) // undefined = not checked yet

  useEffect(() => {
    if (!open) return
    let alive = true
    Promise.all([invoke<string[]>('deckNames'), invoke<string[]>('modelNames')])
      .then(([d, m]) => {
        if (!alive) return
        setDecks(d.sort())
        setModels(m.sort())
        setAnkiError(null)
      })
      .catch((e) => alive && setAnkiError((e as Error).message))
    return () => {
      alive = false
    }
  }, [open])

  useEffect(() => {
    if (!open || !settings.model || ankiError !== null) return setFields([])
    let alive = true
    invoke<string[]>('modelFieldNames', { modelName: settings.model })
      .then((f) => alive && setFields(f))
      .catch(() => alive && setFields([]))
    return () => {
      alive = false
    }
  }, [open, settings.model, ankiError])

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v })
  const ankiOk = ankiError === undefined ? null : ankiError === null
  // Keep the stored value visible even when Anki is closed and the list is empty.
  const withCurrent = (list: string[], cur: string) => (cur && !list.includes(cur) ? [cur, ...list] : list)
  const songTagPreview = buildSongTag(SAMPLE_TRACK, settings.songTagTemplate)
  const updateWindowMin = Math.round(UPDATE_WINDOW_MS / 60000)

  const fieldInput = (k: 'sentenceField' | 'audioField' | 'imageField' | 'sourceField', label: string, hint: string, placeholder?: string) => (
    <Row label={label} hint={hint} htmlFor={k}>
      <Input id={k} type="text" list="lm-fields" value={settings[k]} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} className={fieldClass} />
    </Row>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="flex max-h-[92vh] flex-col gap-0 overflow-hidden rounded-3xl border-0 p-0 shadow-dialog sm:max-w-[640px]">
        <div className="flex items-start justify-between gap-4 px-7 pt-7 pb-5">
          <div className="flex flex-col gap-1">
            <DialogTitle className="text-xl font-extrabold tracking-[-0.3px]">Settings</DialogTitle>
            <DialogDescription className="text-[13px] font-medium text-muted">Changes save as you make them.</DialogDescription>
          </div>
          <DialogClose asChild>
            <button type="button" aria-label="Close" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-soft text-ink hover:bg-line-soft">
              <X className="size-3.5" strokeWidth={2.5} />
            </button>
          </DialogClose>
        </div>

        <ScrollBody>
          <Group
            label="Anki"
            aside={<StatusChip ok={ankiOk}>{ankiOk === null ? 'Checking…' : ankiOk ? 'Connected' : 'Anki is closed'}</StatusChip>}
            note={ankiOk === false ? 'Deck and note type can be changed once Anki is open. The current values are kept.' : undefined}
          >
            <Row label="Deck for new cards" hint="Where mined cards go, and the deck watched for new cards.">
              <Select value={settings.deck || undefined} onValueChange={(v) => set('deck', v)} disabled={!ankiOk}>
                <SelectTrigger className={selectClass} aria-label="Deck for new cards">
                  <SelectValue placeholder="Choose a deck" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {withCurrent(decks, settings.deck).map((d) => (
                    <SelectItem key={d} value={d} className="rounded-lg font-semibold">
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row label="Note type" hint="Its field names fill the suggestions below.">
              <Select value={settings.model || undefined} onValueChange={(v) => set('model', v)} disabled={!ankiOk}>
                <SelectTrigger className={selectClass} aria-label="Note type">
                  <SelectValue placeholder="Choose a note type" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {withCurrent(models, settings.model).map((m) => (
                    <SelectItem key={m} value={m} className="rounded-lg font-semibold">
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
          </Group>

          <Group
            label="Card fields"
            note={`Fields the note type doesn't have are skipped. “Update last card” fills them on the newest note added to the deck in the last ${updateWindowMin} minutes.`}
          >
            <datalist id="lm-fields">
              {fields.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
            {fieldInput('sentenceField', 'Sentence', 'The lyric line.')}
            {fieldInput('audioField', 'Audio', 'A clip of the line from the tab recording.')}
            {fieldInput('imageField', 'Image', 'A frame of the video at that moment.')}
            {fieldInput('sourceField', 'Source', 'Video title and channel. Leave empty to skip.', 'Optional')}
          </Group>

          <Group label="Tags">
            <Row label="On every card" hint="Enter or comma adds a tag.">
              <TagsInput value={settings.tags} onChange={(v) => set('tags', v)} />
            </Row>
            <Row
              label="Per song"
              hint={
                <>
                  Placeholders: <Mono>{'{artist}'}</Mono> <Mono>{'{title}'}</Mono> <Mono>{'{album}'}</Mono> <Mono>{'{channel}'}</Mono>. Leave empty to skip.
                </>
              }
              htmlFor="songTagTemplate"
              below={
                <span className="flex min-w-0 items-baseline gap-2 text-xs font-semibold text-muted">
                  <span className="shrink-0">Example</span>
                  <span className="truncate font-mono text-ink">{songTagPreview ?? '—'}</span>
                </span>
              }
            >
              <Input
                id="songTagTemplate"
                type="text"
                value={settings.songTagTemplate}
                onChange={(e) => set('songTagTemplate', e.target.value)}
                placeholder="Song::{artist}:{title}"
                className={cn(fieldClass, 'font-mono text-[13px]')}
              />
            </Row>
          </Group>

          <Group label="New cards">
            <Row
              label="Detect new Anki cards"
              hint={
                settings.deck
                  ? `While capture is on, a card added to ${settings.deck} gets its line's audio, image and sentence without pressing U. Cards made while this tab is hidden are left alone.`
                  : 'Choose a deck above first. Only cards added to that deck are detected.'
              }
              htmlFor="autoDetect"
              control="switch"
            >
              <Switch id="autoDetect" checked={settings.autoDetect} onCheckedChange={(v) => set('autoDetect', v)} disabled={!settings.deck} />
            </Row>
            {settings.autoDetect && (
              <Row label="When one appears" hint="Fill it in straight away, or open the mining dialog to check the line first.">
                <Select value={settings.autoDetectAction} onValueChange={(v) => set('autoDetectAction', v as AutoDetectAction)}>
                  <SelectTrigger className={selectClass} aria-label="When a new card appears">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="update" className="rounded-lg font-semibold">
                      Update it automatically
                    </SelectItem>
                    <SelectItem value="dialog" className="rounded-lg font-semibold">
                      Open the mining dialog
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Row>
            )}
          </Group>

          <Group label="Clips">
            <Row label="Extra audio before the line" hint="Padding added to the start of every clip." control="compact">
              <Stepper
                className="h-10 border border-line bg-card px-1 [&>button]:size-8 [&>button]:bg-soft"
                value={`${settings.padStart.toFixed(2)} s`}
                onDec={() => set('padStart', Math.max(0, +(settings.padStart - 0.05).toFixed(2)))}
                onInc={() => set('padStart', +(settings.padStart + 0.05).toFixed(2))}
              />
            </Row>
            <Row label="Extra audio after the line" hint="Padding added to the end of every clip." control="compact">
              <Stepper
                className="h-10 border border-line bg-card px-1 [&>button]:size-8 [&>button]:bg-soft"
                value={`${settings.padEnd.toFixed(2)} s`}
                onDec={() => set('padEnd', Math.max(0, +(settings.padEnd - 0.05).toFixed(2)))}
                onInc={() => set('padEnd', +(settings.padEnd + 0.05).toFixed(2))}
              />
            </Row>
          </Group>

          <Group label="Display">
            <Row
              label="Lyrics font size"
              hint={<span className="text-ink tabular-nums">{settings.fontSize} px</span>}
              below={
                <div className="truncate rounded-xl bg-soft px-4 py-3 text-center font-jp font-bold text-ink" style={{ fontSize: settings.fontSize }}>
                  歩いてみるよ
                </div>
              }
            >
              <Slider min={16} max={48} step={1} value={[settings.fontSize]} onValueChange={([v]) => set('fontSize', v)} aria-label="Lyrics font size" className="py-2" />
            </Row>
          </Group>
        </ScrollBody>

        <div className="flex items-center justify-between px-7 pt-5 pb-7">
          <button type="button" onClick={() => onChange({ ...DEFAULT_SETTINGS })} className="text-[13px] font-bold text-coral-text hover:text-coral-deep">
            Reset to defaults
          </button>
          <Button onClick={() => onOpenChange(false)} className="h-11 rounded-[14px] px-[22px] font-bold">
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The scrolling part of the dialog. The header and footer stay put so Done is always in reach, the scrollbar
 * is always shown (native overlay scrollbars hide until you scroll, which is what made the bottom easy to miss),
 * and a border appears on whichever edge has more content behind it.
 */
function ScrollBody({ children }: { children: ReactNode }) {
  const [edges, setEdges] = useState({ top: false, bottom: false })
  const update = (el: HTMLElement) => {
    const top = el.scrollTop > 1
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    setEdges((e) => (e.top === top && e.bottom === bottom ? e : { top, bottom }))
  }
  const viewportRef = (el: HTMLDivElement | null) => {
    if (!el) return
    update(el)
    const ro = new ResizeObserver(() => update(el))
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }
  return (
    <ScrollAreaPrimitive.Root
      type="always"
      className={cn('relative flex min-h-0 flex-1 flex-col overflow-hidden border-y border-transparent transition-colors', edges.top && 'border-t-line', edges.bottom && 'border-b-line')}
    >
      <ScrollAreaPrimitive.Viewport ref={viewportRef} onScroll={(e) => update(e.currentTarget)} className="min-h-0 flex-1">
        <div className="flex flex-col gap-7 px-7 py-1">{children}</div>
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar orientation="vertical" className="my-1 mr-2.5 flex w-2 touch-none select-none">
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-ghost" />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  )
}

/** A titled card of rows. `note` is the one thing worth saying about the group as a whole, under the title. */
function Group({ label, aside, note, children }: { label: string; aside?: ReactNode; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2.5">
          <SectionLabel>{label}</SectionLabel>
          {aside}
        </div>
        {note && <p className="m-0 text-[13px] leading-relaxed font-medium text-muted">{note}</p>}
      </div>
      <div className="flex flex-col divide-y divide-line-soft rounded-2xl border border-line bg-card">{children}</div>
    </section>
  )
}

interface RowProps {
  label: string
  hint: ReactNode
  children: ReactNode
  /** Associates the title with the control, so clicking the title focuses it. */
  htmlFor?: string
  /** `switch` and `compact` controls hug their content; the default takes a fixed column. */
  control?: 'field' | 'switch' | 'compact'
  /** Full-width content under the row, e.g. a preview. */
  below?: ReactNode
}

function Row({ label, hint, children, htmlFor, control = 'field', below }: RowProps) {
  const Title = htmlFor ? 'label' : 'span'
  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      <div
        className={cn('flex items-center gap-5 max-[560px]:flex-col max-[560px]:items-stretch max-[560px]:gap-2.5', control === 'switch' && 'max-[560px]:flex-row max-[560px]:items-center')}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Title htmlFor={htmlFor} className="text-sm font-bold text-ink">
            {label}
          </Title>
          <span className="text-xs leading-relaxed font-medium text-muted">{hint}</span>
        </div>
        <div className={cn('shrink-0', control === 'field' && 'w-[250px] max-[560px]:w-auto')}>{children}</div>
      </div>
      {below}
    </div>
  )
}

function Mono({ children }: { children: ReactNode }) {
  return <code className="rounded bg-soft px-1 py-px font-mono text-[11px] font-bold text-ink-2">{children}</code>
}

/** Comma-separated tags edited as chips. Enter or comma adds; Backspace on an empty draft removes the last one. */
function TagsInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const tags = value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  const [draft, setDraft] = useState('')

  const commit = () => {
    const t = draft.trim().replace(/,+$/, '')
    if (t && !tags.includes(t)) onChange([...tags, t].join(', '))
    setDraft('')
  }
  const removeAt = (i: number) => onChange(tags.filter((_, j) => j !== i).join(', '))

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border border-line bg-card px-1.5 py-1 focus-within:border-coral focus-within:ring-[3px] focus-within:ring-coral/20">
      {tags.map((t, i) => (
        <span key={t} className="flex h-[26px] items-center gap-1 rounded-full bg-soft pr-1.5 pl-2.5 text-xs font-bold text-ink">
          {t}
          <button
            type="button"
            aria-label={`Remove tag ${t}`}
            onClick={() => removeAt(i)}
            className="flex size-4 items-center justify-center rounded-full text-faint hover:bg-line hover:text-ink"
          >
            <X className="size-2.5" strokeWidth={3} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Backspace' && !draft && tags.length) {
            removeAt(tags.length - 1)
          }
        }}
        placeholder={tags.length ? '' : 'Add a tag'}
        aria-label="Add a tag"
        className="min-w-[70px] flex-1 bg-transparent px-1.5 text-sm font-semibold outline-none placeholder:font-medium placeholder:text-faint"
      />
    </div>
  )
}
