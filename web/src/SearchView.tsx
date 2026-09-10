import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Disc3, ExternalLink, Link2, Sparkles, X } from 'lucide-react'
import { cn } from 'cn'
import type { TrackInfo } from '../../shared/types'
import type { SearchRequest } from './App'
import { bookmarkletHref, youtubeSearchUrl } from './api'
import { BuyMeACoffee, Card, HowStep, SectionLabel } from './components/primitives'
import { forgetTrack, loadLibrary } from './library'
import { formatTime } from './lrc'

interface Props {
  request: SearchRequest
  onOpen: (id: string) => void
  /** Leave the "search" hand-off page and show the library again. */
  onClear: () => void
}

export function SearchView({ request, onOpen, onClear }: Props) {
  const [library, setLibrary] = useState<TrackInfo[]>(loadLibrary)

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
              <SectionLabel className="text-muted">Search</SectionLabel>
            </div>
            <Card className="flex flex-col items-start gap-4 px-6 py-6 shadow-card-sm">
              <div className="flex flex-col gap-1.5">
                <span className="text-[17px] font-bold">
                  Search YouTube for <span className="font-jp">“{request.q}”</span>
                </span>
                <span className="max-w-[560px] text-[13px] leading-relaxed font-medium text-muted">
                  A website can't search YouTube on its own. Find the song there, then paste its link into the box above, or use the bookmarklet
                  to jump straight back here from the video page.
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={youtubeSearchUrl(request.q)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 items-center gap-2 rounded-[14px] bg-ink px-4 text-[13px] font-bold text-white hover:bg-ink-2"
                >
                  Open YouTube results <ExternalLink className="size-3.5" />
                </a>
                <Bookmarklet />
              </div>
            </Card>
          </section>
        ) : (
          <>
            <section className="flex flex-col gap-3.5">
              <div className="flex items-center gap-3">
                <SectionLabel className="text-muted">Library</SectionLabel>
                <span className="text-[13px] font-medium text-faint">
                  {library.length ? `${library.length} ${library.length === 1 ? 'song' : 'songs'}` : 'Songs you open are kept here.'}
                </span>
                {library.length > 0 && (
                  <>
                    <div className="flex-1" />
                    <Bookmarklet compact />
                  </>
                )}
              </div>
              {library.length > 0 ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
                  {library.map((t) => (
                    <SongCard key={t.id} title={t.title} channel={t.channel} thumbnail={t.thumbnail} duration={t.duration} onOpen={() => onOpen(t.id)} onRemove={(e) => remove(e, t.id)} />
                  ))}
                </div>
              ) : (
                <Card className="flex flex-col items-start gap-4 px-6 py-6 shadow-card-sm">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[17px] font-bold">Add your first song</span>
                    <span className="max-w-[560px] text-[13px] leading-relaxed font-medium text-muted">
                      Paste a YouTube link into the box above. For a one-click route, drag the bookmarklet to your bookmarks bar and click it on any
                      YouTube video.
                    </span>
                  </div>
                  <Bookmarklet />
                </Card>
              )}
            </section>

            <section className="flex flex-col gap-3.5">
              <SectionLabel className="text-muted">How it works</SectionLabel>
              <Card className="grid grid-cols-3 divide-x divide-line-soft shadow-card-sm max-[900px]:grid-cols-1 max-[900px]:divide-x-0 max-[900px]:divide-y">
                <HowStep icon={Link2} title="Open a song" className="px-6 py-5">
                  Paste a YouTube link, or click the bookmarklet on any YouTube video. Lyrics come from LRCLIB and every line is plain text for
                  Yomitan.
                </HowStep>
                <HowStep icon={Disc3} title="Record this tab" className="px-6 py-5">
                  Press <b>Start capture</b> and share this tab with its audio. The recording stays in your browser and never leaves it.
                </HowStep>
                <HowStep icon={Sparkles} title="Mine a line" className="px-6 py-5">
                  Make a card with Yomitan, then press <b>U</b> to add that line's audio, image and sentence to it. Keyboard shortcuts are
                  listed under the lyrics.
                </HowStep>
              </Card>
            </section>
          </>
        )}

        <BuyMeACoffee className="mx-auto" />
      </div>
    </div>
  )
}

/**
 * Draggable bookmarklet link. React refuses `javascript:` hrefs, so the attribute is set imperatively.
 * Clicking it in place does nothing useful, so the click is swallowed.
 */
export function Bookmarklet({ compact = false }: { compact?: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    ref.current?.setAttribute('href', bookmarkletHref())
  }, [])
  return (
    <a
      ref={ref}
      onClick={(e) => e.preventDefault()}
      draggable
      title="Drag me to your bookmarks bar"
      className={cn(
        'inline-flex cursor-grab items-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-coral bg-coral-wash font-bold text-coral-deep active:cursor-grabbing',
        compact ? 'h-8 px-3 text-xs' : 'h-11 px-4 text-[13px]',
      )}
    >
      Mine in LyricMiner
      <span className="font-medium text-coral-text/70">· drag to bookmarks</span>
    </a>
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
