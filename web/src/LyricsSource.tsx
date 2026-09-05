import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from 'cn'
import type { LyricsResult, TrackInfo } from '../../shared/types'
import { lyricsSearch } from './api'
import { SectionLabel, Stepper } from './components/primitives'
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

export function LyricsSource({ info, saved, onChange, trailing }: Props) {
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
            <div className="flex items-center gap-2.5 text-[13px] font-medium text-muted" title="Positive when lyrics show up too early">
              <span>Offset</span>
              <Stepper
                value={`${offsetMs < 0 ? '−' : '+'}${Math.abs(offsetMs)} ms`}
                onDec={() => setOffset(offsetMs - 100)}
                onInc={() => setOffset(offsetMs + 100)}
                decLabel="Lyrics 100 ms earlier"
                incLabel="Lyrics 100 ms later"
              />
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
