import { memo, useEffect, useRef } from 'react'
import { Play, Plus } from 'lucide-react'
import { cn } from 'cn'
import type { LyricLine } from './lrc'
import { formatTime } from './lrc'

interface Props {
  lines: LyricLine[]
  activeIndex: number
  fontSize: number
  onPlay: (i: number) => void
  onMine: (i: number) => void
}

export const LyricsList = memo(function LyricsList({ lines, activeIndex, fontSize, onPlay, onMine }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const hovering = useRef(false)

  // Keep the active line centered, but never move text out from under the mouse while the user is scanning it.
  useEffect(() => {
    if (activeIndex < 0 || hovering.current) return
    const el = ref.current?.querySelector<HTMLElement>(`[data-i="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'center' })
  }, [activeIndex])

  if (!lines.length) {
    return (
      <div className="flex flex-1 items-center justify-center p-10 text-center leading-relaxed font-medium text-muted">
        No synced lyrics loaded yet.
        <br />
        Use the Lyrics controls above to search LRCLIB or paste an LRC file.
      </div>
    )
  }

  return (
    <div
      ref={ref}
      className="min-h-0 flex-1 overflow-y-auto scroll-smooth px-6 pt-[30vh] pb-[40vh]"
      onMouseEnter={() => (hovering.current = true)}
      onMouseLeave={() => (hovering.current = false)}
    >
      <div className="flex flex-col gap-1">
        {lines.map((l, i) => {
          const active = i === activeIndex
          const past = activeIndex >= 0 && i < activeIndex
          return (
            <div
              key={i}
              data-i={i}
              data-active={active}
              onClick={() => onPlay(i)}
              title={active ? undefined : 'Click to play this line'}
              className={cn(
                'group flex cursor-pointer items-center gap-[18px] rounded-[14px] px-4 py-2.5 transition-colors',
                active ? 'rounded-2xl bg-coral-wash py-3.5 text-ink' : 'hover:bg-soft hover:text-ink',
                !active && (past ? 'text-ghost' : 'text-muted'),
              )}
            >
              {/* Left gutter: timestamp, swapped for Mine (+) on the active row and Play on any other hovered row. */}
              <div className="flex w-11 shrink-0 justify-end">
                <span
                  className={cn(
                    'items-center text-xs font-bold tabular-nums',
                    active ? 'hidden' : 'flex group-hover:hidden',
                    past ? 'text-ghost' : 'text-faint',
                  )}
                >
                  {formatTime(l.start)}
                </span>
                {active ? (
                  <button
                    type="button"
                    title="Mine this line (M)"
                    aria-label="Mine this line"
                    onClick={(e) => {
                      e.stopPropagation()
                      onMine(i)
                    }}
                    className="flex size-10 items-center justify-center rounded-full bg-coral text-white transition-colors hover:bg-coral-deep"
                  >
                    <Plus className="size-4" strokeWidth={2.5} />
                  </button>
                ) : (
                  <button
                    type="button"
                    title="Play this line"
                    aria-label="Play this line"
                    onClick={(e) => {
                      e.stopPropagation()
                      onPlay(i)
                    }}
                    className="hidden size-9 items-center justify-center rounded-full border border-line bg-card text-ink transition-colors group-hover:flex hover:bg-soft"
                  >
                    <Play className="size-3 translate-x-px" fill="currentColor" />
                  </button>
                )}
              </div>

              {/* The text glyphs themselves are not a click target so they stay selectable and scannable;
                  the empty space to their right still plays the line. */}
              <div className="min-w-0 flex-1 font-jp leading-[1.35] font-bold" style={{ fontSize: active ? Math.round(fontSize * 1.4) : past ? Math.round(fontSize * 0.92) : fontSize }}>
                <span onClick={(e) => e.stopPropagation()} className="cursor-text select-text">
                  {l.text}
                </span>
              </div>

              {active && <span className="shrink-0 text-xs font-extrabold text-coral-text tabular-nums">{formatTime(l.start)}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
})
