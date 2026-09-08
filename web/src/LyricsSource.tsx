import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from 'cn'
import { LocateFixed } from 'lucide-react'
import type { LyricsResult, TrackInfo } from '../../shared/types'
import { lyricsSearch } from './api'
import { RoundButton, SectionLabel, Stepper } from './components/primitives'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { parseLrc } from './lrc'
import type { SavedLyrics } from './storage'

interface Props {
  info: TrackInfo | null
  saved: SavedLyrics | null
  onChange: (l: SavedLyrics | null) => void
  /** Rendered at the right end of the header row (font-size controls). */
  trailing?: ReactNode
  /** Start of the first lyric line before any offset is applied, in seconds. */
  firstLineStart?: number
  /** Current playhead in seconds, or null while there's no player yet. */
  playhead?: () => number | null
}

/** Strip bracketed junk like [Official Video] / (MV) / 【歌詞】 from a YouTube title before searching LRCLIB. */
export function cleanTitle(title: string): string {
  return title
    .replace(/[\[(【（].*?[\])】）]/g, ' ')
    .replace(/\b(official|music|video|mv|lyrics?|audio|hd|4k|full|ver\.?|version|歌詞|公式)\b/gi, ' ')
    .replace(/[|｜/／]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function LyricsSource({ info, saved, onChange, trailing, firstLineStart, playhead }: Props) {
  const [open, setOpen] = useState(!saved)
  const [track, setTrack] = useState('')
  const [artist, setArtist] = useState('')
  const [results, setResults] = useState<LyricsResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paste, setPaste] = useState('')
  const autoRan = useRef(false)

  const runSearch = async (t: string, a: string, autoSelect: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const attempts: { track?: string; artist?: string; q?: string }[] = []
      if (t && a) attempts.push({ track: t, artist: a })
      if (!a && t.includes(' - ')) {
        // "Artist - Track" is the usual YouTube title shape; try both orders.
        const [left, right] = t.split(' - ').map((s) => s.trim())
        if (left && right) attempts.push({ track: right, artist: left }, { track: left, artist: right })
      }
      attempts.push({ q: [t, a].filter(Boolean).join(' ') })
      let res: LyricsResult[] = []
      for (const attempt of attempts) {
        res = await lyricsSearch(attempt)
        if (res.some((r) => r.syncedLyrics)) break
      }
      setResults(res)
      if (autoSelect) {
        const best = res.find((r) => r.syncedLyrics)
        if (best) select(best)
        else setOpen(true)
      }
    } catch (e) {
      setError((e as Error).message)
      setOpen(true)
    } finally {
      setBusy(false)
    }
  }

  // Prefill the form and auto-search once we know what the video is.
  useEffect(() => {
    if (!info) return
    const t = info.track ?? cleanTitle(info.title)
    const a = info.artist ?? ''
    setTrack(t)
    setArtist(a)
    if (!saved && !autoRan.current) {
      autoRan.current = true
      void runSearch(t, a, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info])

  const select = (r: LyricsResult) => {
    if (!r.syncedLyrics) return
    onChange({ lrc: r.syncedLyrics, offset: 0, label: `${r.trackName} — ${r.artistName}` })
    setOpen(false)
  }

  const usePasted = () => {
    const lines = parseLrc(paste)
    if (!lines.length) {
      setError('No timestamped lines found. LRC lines look like [01:23.45] text')
      return
    }
    onChange({ lrc: paste, offset: 0, label: 'Pasted LRC' })
    setPaste('')
    setOpen(false)
  }

  const setOffset = (ms: number) => {
    if (saved) onChange({ ...saved, offset: Math.round(ms) / 1000 })
  }
  const offsetMs = Math.round((saved?.offset ?? 0) * 1000)
  /** ± 100 ms per click, ± 1 s with Shift held. */
  const step = (e: React.MouseEvent, dir: 1 | -1) => setOffset(offsetMs + dir * (e.shiftKey ? 1000 : 100))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const startEdit = () => {
    setDraft(String(offsetMs))
    setEditing(true)
  }
  const commitEdit = () => {
    setEditing(false)
    const ms = parseOffsetInput(draft)
    if (ms !== null) setOffset(ms)
  }
  /** Long intro: the user presses this the moment the first line is actually sung. */
  const syncFirstLine = () => {
    const t = playhead?.()
    if (t == null || firstLineStart == null) return
    setOffset((t - firstLineStart) * 1000)
  }
  const canSync = !!saved && firstLineStart != null && !!playhead

  return (
    <>
      <div className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-line-soft pr-5 pl-6">
        <div className="flex min-w-0 items-center gap-3.5">
          <SectionLabel>Lyrics</SectionLabel>
          {saved ? (
            <>
              <span className="truncate font-bold">{saved.label}</span>
              <span className="flex h-[22px] shrink-0 items-center rounded-md bg-soft px-2 text-[11px] font-bold text-muted">
                {saved.label === 'Pasted LRC' ? 'pasted' : 'LRCLIB · synced'}
              </span>
              <button type="button" onClick={() => setOpen((o) => !o)} className="shrink-0 text-[13px] font-bold text-coral-text hover:text-coral-deep">
                {open ? 'Close' : 'Change'}
              </button>
            </>
          ) : (
            <span className="truncate font-medium text-muted">{busy ? 'Looking up synced lyrics…' : 'No synced lyrics yet'}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3.5">
          {saved && (
            <div className="flex items-center gap-2.5 text-[13px] font-medium text-muted" title="Positive when lyrics show up too early. Click the value to type one; Shift-click − / + for 1 s steps.">
              <span>Offset</span>
              <Stepper
                value={
                  editing ? (
                    <input
                      autoFocus
                      inputMode="numeric"
                      aria-label="Offset in milliseconds"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit()
                        if (e.key === 'Escape') setEditing(false)
                        e.stopPropagation()
                      }}
                      className="w-[76px] rounded-md bg-card px-1 text-center text-[13px] font-bold text-ink tabular-nums outline-none ring-1 ring-coral"
                    />
                  ) : (
                    <button type="button" onClick={startEdit} title="Type an offset (ms, or e.g. 12.5s)" className="rounded-md px-1 hover:bg-line-soft">
                      {`${offsetMs < 0 ? '−' : '+'}${Math.abs(offsetMs)} ms`}
                    </button>
                  )
                }
                onDec={(e) => step(e, -1)}
                onInc={(e) => step(e, 1)}
                decLabel="Lyrics 100 ms earlier (Shift: 1 s)"
                incLabel="Lyrics 100 ms later (Shift: 1 s)"
              />
              {canSync && (
                <RoundButton
                  size="sm"
                  label="First line starts now — press it the moment the first line is sung"
                  onClick={syncFirstLine}
                >
                  <LocateFixed strokeWidth={2.5} />
                </RoundButton>
              )}
            </div>
          )}
          {trailing && (
            <>
              <div className="h-5 w-px bg-line-soft" />
              {trailing}
            </>
          )}
        </div>
      </div>

      {open && (
        <div className="flex shrink-0 flex-col gap-3 border-b border-line-soft bg-soft/60 px-6 py-4">
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void runSearch(track.trim(), artist.trim(), false)
            }}
          >
            <Input className="h-10 min-w-[160px] flex-1 rounded-xl border-line bg-card font-semibold shadow-none" placeholder="Track" value={track} onChange={(e) => setTrack(e.target.value)} />
            <Input className="h-10 min-w-[160px] flex-1 rounded-xl border-line bg-card font-semibold shadow-none" placeholder="Artist" value={artist} onChange={(e) => setArtist(e.target.value)} />
            <Button type="submit" disabled={busy || !track.trim()} className="h-10 rounded-xl px-4 font-bold">
              {busy ? 'Searching…' : 'Search LRCLIB'}
            </Button>
          </form>
          {error && <div className="text-[13px] font-semibold text-bad-text">{error}</div>}
          {results && results.length === 0 && (
            <div className="text-[13px] font-medium text-muted">LRCLIB has nothing for that. Try a different spelling, or paste an LRC below.</div>
          )}
          {results && results.length > 0 && (
            <div className="flex max-h-[260px] flex-col gap-1.5 overflow-y-auto">
              {results.map((r) => {
                const preview = (r.syncedLyrics ?? r.plainLyrics ?? '')
                  .split('\n')
                  .map((l) => l.replace(/\[[^\]]*\]/g, '').trim())
                  .filter(Boolean)
                  .slice(0, 2)
                  .join(' · ')
                const selected = saved?.label === `${r.trackName} — ${r.artistName}`
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={!r.syncedLyrics}
                    onClick={() => select(r)}
                    title={r.syncedLyrics ? 'Use these lyrics' : 'No timestamps available for this entry'}
                    className={cn(
                      'flex w-full flex-col gap-0.5 rounded-xl border bg-card px-3.5 py-2.5 text-left transition-colors disabled:opacity-50',
                      selected ? 'border-coral bg-coral-wash' : 'border-line hover:border-coral',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex-1 truncate font-bold">
                        {r.trackName} <span className="font-medium text-muted">— {r.artistName}</span>
                      </span>
                      <span className={cn('h-[22px] shrink-0 rounded-md px-2 text-[11px] leading-[22px] font-bold', r.syncedLyrics ? 'bg-ok-tint text-ok-text' : 'bg-soft text-muted')}>
                        {r.syncedLyrics ? 'synced' : r.instrumental ? 'instrumental' : 'plain only'}
                      </span>
                    </div>
                    <div className="truncate font-jp text-xs font-medium text-faint">{preview}</div>
                  </button>
                )
              })}
            </div>
          )}
          <details className="group">
            <summary className="cursor-pointer list-none text-[13px] font-bold text-coral-text hover:text-coral-deep">
              <span className="group-open:hidden">Paste an LRC file instead</span>
              <span className="hidden group-open:inline">Paste an LRC file</span>
            </summary>
            <Textarea
              placeholder={'[00:12.34] first line\n[00:15.67] second line'}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              className="mt-2 min-h-[100px] rounded-xl border-line bg-card font-mono text-xs shadow-none"
            />
            <div className="mt-2 flex">
              <Button type="button" variant="outline" disabled={!paste.trim()} onClick={usePasted} className="h-9 rounded-xl font-bold">
                Use pasted lyrics
              </Button>
            </div>
          </details>
        </div>
      )}
    </>
  )
}

/** Accepts "1500", "-300", "+2.5s", "12,5 s"; returns milliseconds or null when unparseable. */
export function parseOffsetInput(raw: string): number | null {
  const m = raw.trim().replace('−', '-').replace(',', '.').match(/^([+-]?\d+(?:\.\d+)?)\s*(ms|s)?$/i)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  const unit = m[2]?.toLowerCase()
  // Bare numbers are ms; a decimal with no unit reads as seconds ("12.5").
  return Math.round(unit === 's' || (!unit && m[1].includes('.')) ? n * 1000 : n)
}
