import { useEffect, useState } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { cn } from 'cn'
import type { SearchResult, TrackInfo } from '../../shared/types'
import type { SearchRequest, ToastFn } from './App'
import { api } from './api'
import { forgetTrack, loadLibrary } from './library'
import { Card, Key, SectionLabel } from './components/primitives'
import { formatTime } from './lrc'

interface Props {
  request: SearchRequest
  onOpen: (id: string) => void
  /** Leave the results page and show the library again. */
  onClear: () => void
  toast: ToastFn
}

export function SearchView({ request, onOpen, onClear, toast }: Props) {
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [library, setLibrary] = useState<TrackInfo[]>(loadLibrary)

  useEffect(() => {
    if (!request.q) return
    let alive = true
    setBusy(true)
    setResults(null)
    api
      .search(request.q)
      .then((r) => alive && setResults(r))
      .catch((e: Error) => alive && toast(e.message, 'bad'))
      .finally(() => alive && setBusy(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.nonce])

  const remove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!confirm('Remove this song from your library? (Saved lyrics selection is kept.)')) return
    forgetTrack(id)
    setLibrary(loadLibrary())
  }

  const searching = !!request.q

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-7 pt-2 pb-7">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-7">
        {searching ? (
          <section className="flex flex-col gap-3.5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClear}
                className="flex h-8 items-center gap-1.5 rounded-full bg-card px-3 pl-2.5 text-[13px] font-bold text-ink-2 shadow-card-sm hover:bg-soft"
              >
                <ArrowLeft className="size-3.5" strokeWidth={2.5} />
                Library
              </button>
              <SectionLabel className="text-muted">Results</SectionLabel>
              <span className="text-[13px] font-medium text-faint">
                {busy ? `Searching YouTube for “${request.q}”…` : results?.length ? `for “${request.q}” · ${results.length} songs` : `nothing found for “${request.q}”`}
              </span>
            </div>
            {busy && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4" aria-busy="true" aria-label="Loading results">
                {Array.from({ length: 8 }, (_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            )}
            {!busy && results && results.length > 0 && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
                {results.map((r) => (
                  <SongCard key={r.id} title={r.title} channel={r.channel} thumbnail={r.thumbnail} duration={r.duration} onOpen={() => onOpen(r.id)} />
                ))}
              </div>
            )}
            {!busy && results && results.length === 0 && (
              <Card className="flex flex-col items-center gap-2 px-6 py-10 text-center shadow-card-sm">
                <span className="font-bold">Nothing found</span>
                <span className="max-w-[420px] text-[13px] leading-relaxed font-medium text-faint">
                  Try the song title in Japanese or romaji, add the artist, or paste a YouTube link directly into the search box.
                </span>
              </Card>
            )}
          </section>
        ) : (
          <>
            <section className="flex flex-col gap-3.5">
              <div className="flex items-baseline gap-3">
                <SectionLabel className="text-muted">Library</SectionLabel>
                <span className="text-[13px] font-medium text-faint">
                  {library.length ? `${library.length} ${library.length === 1 ? 'song' : 'songs'}` : 'Songs you open are kept here. Search above to add your first one.'}
                </span>
              </div>
              {library.length > 0 && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
                  {library.map((t) => (
                    <SongCard
                      key={t.id}
                      title={t.title}
                      channel={t.channel}
                      thumbnail={t.thumbnail}
                      duration={t.duration}
                      onOpen={() => onOpen(t.id)}
                      onRemove={(e) => remove(e, t.id)}
                    />
                  ))}
                </div>
              )}
            </section>

            <Card className="grid grid-cols-[200px_minmax(0,1fr)] items-center gap-6 px-6 py-5 shadow-card-sm max-[900px]:grid-cols-1">
              <div className="flex flex-col gap-1">
                <SectionLabel className="text-muted">How it works</SectionLabel>
                <span className="text-[13px] leading-relaxed font-medium text-faint">
                  Pick a song. It plays from YouTube, lyrics come from LRCLIB, and every line is plain text for Yomitan. Start capture to record audio for cards.
                </span>
              </div>
              <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-2">
                <Hint keys={['←', '→', '↑']}>Jump between lines, replay one</Hint>
                <Hint keys={['A', 'R']}>Auto-pause after each line, loop a line</Hint>
                <Hint keys={['U']}>Add audio, image and sentence to the card Yomitan just made</Hint>
                <Hint keys={['M']}>Fine-tune the clip first</Hint>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="flex animate-pulse flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-card-sm">
      <div className="aspect-video bg-soft" />
      <div className="flex flex-col gap-2 px-3.5 pt-3 pb-3.5">
        <div className="h-3.5 w-[85%] rounded bg-soft" />
        <div className="h-3.5 w-[55%] rounded bg-soft" />
        <div className="h-3 w-[40%] rounded bg-line-soft" />
      </div>
    </div>
  )
}

function Hint({ keys, children }: { keys: string[]; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-soft px-3.5 py-3">
      <div className="flex gap-1.5">
        {keys.map((k) => (
          <Key key={k}>{k}</Key>
        ))}
      </div>
      <span className="text-xs font-semibold text-ink-2">{children}</span>
    </div>
  )
}

interface SongCardProps {
  title: string
  channel: string
  thumbnail: string
  duration: number | null
  onOpen: () => void
  onRemove?: (e: React.MouseEvent) => void
}

function SongCard({ title, channel, thumbnail, duration, onOpen, onRemove }: SongCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
      className={cn(
        'group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-line bg-card text-left shadow-card-sm transition-[border-color,box-shadow]',
        'hover:border-coral hover:shadow-[0_1px_2px_rgba(30,20,10,0.04),0_10px_26px_rgba(30,20,10,0.08)] focus-visible:border-coral focus-visible:outline-none',
      )}
    >
      <div className="relative aspect-video bg-black">
        <img src={thumbnail} alt="" loading="lazy" className="block h-full w-full object-cover" />
        {duration != null && (
          <span className="absolute right-2 bottom-2 flex h-[22px] items-center rounded-md bg-ink/65 px-[7px] text-xs font-bold text-white">{formatTime(duration)}</span>
        )}
        {onRemove && (
          <button
            type="button"
            title="Remove from library"
            aria-label="Remove from library"
            onClick={onRemove}
            className="absolute top-2 left-2 flex size-7 items-center justify-center rounded-full bg-ink/65 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-bad focus-visible:opacity-100"
          >
            <X className="size-3" strokeWidth={2.5} />
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1 px-3.5 pt-3 pb-3.5">
        <div className="line-clamp-2 font-jp text-sm leading-[1.35] font-bold">{title}</div>
        <div className="truncate text-xs font-medium text-muted">{channel}</div>
      </div>
    </div>
  )
}
