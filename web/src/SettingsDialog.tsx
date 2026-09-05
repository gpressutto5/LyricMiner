import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from 'cn'
import { invoke } from './anki'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { SectionLabel, StatusChip, Stepper } from './components/primitives'
import { DEFAULT_SETTINGS, type Settings } from './storage'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: Settings
  onChange: (s: Settings) => void
}

const fieldClass = 'h-[42px] rounded-xl border-0 bg-soft px-3.5 font-semibold shadow-none focus-visible:ring-coral/30 md:text-sm'

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

  const fieldInput = (k: 'sentenceField' | 'audioField' | 'imageField' | 'sourceField', label: string, hint?: string) => (
    <Field label={label}>
      <Input type="text" list="lm-fields" value={settings[k]} onChange={(e) => set(k, e.target.value)} placeholder={hint} className={fieldClass} />
    </Field>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="flex max-h-[92vh] flex-col gap-[22px] overflow-y-auto rounded-3xl border-0 p-6 shadow-dialog sm:max-w-[720px]">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <DialogTitle className="text-xl font-extrabold tracking-[-0.3px]">Settings</DialogTitle>
            <DialogDescription className="text-[13px] font-medium text-muted">Saved as you change them · Esc to close</DialogDescription>
          </div>
          <DialogClose asChild>
            <button type="button" aria-label="Close" className="flex size-9 items-center justify-center rounded-full bg-soft text-ink hover:bg-line-soft">
              <X className="size-3.5" strokeWidth={2.5} />
            </button>
          </DialogClose>
        </div>

        {/* Anki */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <SectionLabel>Anki</SectionLabel>
            <StatusChip ok={ankiOk}>{ankiOk === null ? 'Checking AnkiConnect…' : ankiOk ? 'AnkiConnect reachable' : 'Anki is closed — deck and note type are locked, values are kept'}</StatusChip>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Deck for new cards">
              <Select value={settings.deck || undefined} onValueChange={(v) => set('deck', v)} disabled={!ankiOk}>
                <SelectTrigger className={cn(fieldClass, 'w-full data-[size=default]:h-[42px] disabled:opacity-60 [&_svg]:text-faint')}>
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
            </Field>
            <Field label="Note type">
              <Select value={settings.model || undefined} onValueChange={(v) => set('model', v)} disabled={!ankiOk}>
                <SelectTrigger className={cn(fieldClass, 'w-full data-[size=default]:h-[42px] disabled:opacity-60 [&_svg]:text-faint')}>
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
            </Field>
          </div>
          <datalist id="lm-fields">
            {fields.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <div className="grid grid-cols-4 gap-3 max-[640px]:grid-cols-2">
            {fieldInput('sentenceField', 'Sentence field')}
            {fieldInput('audioField', 'Audio field')}
            {fieldInput('imageField', 'Image field')}
            {fieldInput('sourceField', 'Source field', 'optional')}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tags">
              <TagsInput value={settings.tags} onChange={(v) => set('tags', v)} />
            </Field>
            <Field label="Per-song tag">
              <Input type="text" value={settings.songTagTemplate} onChange={(e) => set('songTagTemplate', e.target.value)} placeholder="Song::{artist}:{title}" className={cn(fieldClass, 'tabular-nums')} />
            </Field>
          </div>
          <p className="m-0 rounded-xl bg-coral-wash px-3.5 py-3 text-xs leading-relaxed font-medium text-ink-2/80">
            Per-song tag placeholders: <b className="text-ink-2">{'{artist} {title} {album} {channel}'}</b>. Values are squashed to PascalCase, so{' '}
            <b className="text-ink-2">Song::{'{artist}'}:{'{title}'}</b> gives something like <b className="text-ink-2">Song::Yorushika:TheHitchhikersGuide</b>. Leave it empty to skip.
            “Update last card” writes into whichever of these fields exist on the newest note; missing fields are skipped.
          </p>
        </section>

        {/* Clips */}
        <section className="flex flex-col gap-3">
          <SectionLabel>Clips</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Extra audio before the line">
              <Stepper
                className="h-[42px] w-full justify-between px-1 [&>button]:size-[34px]"
                value={`${settings.padStart.toFixed(2)} s`}
                onDec={() => set('padStart', Math.max(0, +(settings.padStart - 0.05).toFixed(2)))}
                onInc={() => set('padStart', +(settings.padStart + 0.05).toFixed(2))}
              />
            </Field>
            <Field label="Extra audio after the line">
              <Stepper
                className="h-[42px] w-full justify-between px-1 [&>button]:size-[34px]"
                value={`${settings.padEnd.toFixed(2)} s`}
                onDec={() => set('padEnd', Math.max(0, +(settings.padEnd - 0.05).toFixed(2)))}
                onInc={() => set('padEnd', +(settings.padEnd + 0.05).toFixed(2))}
              />
            </Field>
          </div>
        </section>

        {/* Display */}
        <section className="flex flex-col gap-3">
          <SectionLabel>Display</SectionLabel>
          <div className="grid grid-cols-[minmax(0,1fr)_200px] items-center gap-4">
            <div className="flex flex-col gap-2.5">
              <div className="flex justify-between text-xs font-bold text-muted">
                <span>Lyrics font size</span>
                <span className="text-ink tabular-nums">{settings.fontSize} px</span>
              </div>
              <Slider min={16} max={48} step={1} value={[settings.fontSize]} onValueChange={([v]) => set('fontSize', v)} aria-label="Lyrics font size" />
            </div>
            <div className="truncate rounded-xl bg-soft px-3.5 py-2.5 text-center font-jp font-bold" style={{ fontSize: settings.fontSize }}>
              歩いてみるよ
            </div>
          </div>
        </section>

        <div className="flex items-center justify-between pt-1">
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold text-muted">{label}</span>
      {children}
    </label>
  )
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
    <div className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-xl bg-soft px-2 py-1.5">
      {tags.map((t, i) => (
        <span key={t} className="flex h-[26px] items-center gap-1 rounded-full border border-line bg-card pr-1.5 pl-2.5 text-xs font-bold">
          {t}
          <button type="button" aria-label={`Remove tag ${t}`} onClick={() => removeAt(i)} className="flex size-4 items-center justify-center rounded-full text-faint hover:bg-soft hover:text-ink">
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
        placeholder={tags.length ? '' : 'lyricminer'}
        className="min-w-[80px] flex-1 bg-transparent px-1.5 text-sm font-semibold outline-none placeholder:text-faint"
      />
    </div>
  )
}
