import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LyricLine } from './lrc'
import type { EventedTransport } from './transport'

export interface PlayerOptions {
  /** Playback surface; null until the player has been created. */
  transport: EventedTransport | null
  lines: LyricLine[]
  offset: number
  keyboardEnabled: boolean
  onMine?: () => void
  onQuickUpdate?: () => void
}

/**
 * Drives a Transport (the YouTube player) with lyric-line awareness:
 *  - tracks the active line at animation-frame precision
 *  - auto-pause at line end, or loop the current line
 *  - keyboard: ← prev, → next, ↑ repeat, space play/pause, A auto-pause, R repeat, M mine, U update last card
 */
export function usePlayer({ transport, lines, offset, keyboardEnabled, onMine, onQuickUpdate }: PlayerOptions) {
  const videoRef = useRef<EventedTransport | null>(transport)
  videoRef.current = transport
  /** Playhead subscribers (see usePlayerTime). Kept out of React state so the whole view doesn't re-render ~12×/s. */
  const timeListeners = useRef(new Set<(t: number) => void>())
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [autoPause, setAutoPause] = useState(false)
  const [repeat, setRepeat] = useState(false)
  const [rate, setRate] = useState(1)

  const shifted = useMemo(
    () => lines.map((l) => ({ ...l, start: Math.max(0, l.start + offset), end: Math.max(0, l.end + offset) })),
    [lines, offset],
  )
  const linesRef = useRef(shifted)
  linesRef.current = shifted
  const autoPauseRef = useRef(autoPause)
  autoPauseRef.current = autoPause
  const repeatRef = useRef(repeat)
  repeatRef.current = repeat
  // Callbacks live in refs so callers can pass fresh closures every render without re-binding the key handler.
  const onMineRef = useRef(onMine)
  onMineRef.current = onMine
  const onQuickUpdateRef = useRef(onQuickUpdate)
  onQuickUpdateRef.current = onQuickUpdate

  /** Index of the line currently being watched for its end (n = past the last line, -1 = before the first). */
  const armedRef = useRef(-1)
  /** Line index we auto-paused at the end of, so the next play() advances instead of re-pausing. */
  const pausedAtEndRef = useRef(-1)
  const activeRef = useRef(-1)
  /** >0 while a caller (the capture replay) has asked us not to auto-pause / repeat. */
  const holdRef = useRef(0)

  /** Last line whose start <= t, or -1. */
  const indexAt = useCallback((t: number) => {
    const arr = linesRef.current
    let lo = 0
    let hi = arr.length - 1
    let ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (arr[mid].start <= t) {
        ans = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return ans
  }, [])

  const arm = useCallback(
    (t: number) => {
      const arr = linesRef.current
      const c = indexAt(t)
      armedRef.current = c >= 0 && t >= arr[c].end ? c + 1 : c
      pausedAtEndRef.current = -1
    },
    [indexAt],
  )

  // Re-arm when the lyric set or offset changes.
  useEffect(() => {
    const v = videoRef.current
    if (v) arm(v.currentTime)
  }, [shifted, arm])

  useEffect(() => {
    let raf = 0
    let lastTimeUpdate = 0
    const tick = () => {
      const v = videoRef.current
      if (v) {
        const t = v.currentTime
        const arr = linesRef.current
        const n = arr.length
        const now = performance.now()
        if (now - lastTimeUpdate > 80) {
          for (const fn of timeListeners.current) fn(t)
          lastTimeUpdate = now
        }
        const c = indexAt(t)
        const active = c >= 0 && t < arr[c].end ? c : -1
        if (active !== activeRef.current) {
          activeRef.current = active
          setActiveIndex(active)
        }

        if (!v.paused && n > 0 && holdRef.current === 0) {
          const a = armedRef.current
          if (a < 0) {
            if (c >= 0) armedRef.current = c
          } else if (a >= n) {
            if (t < arr[n - 1].end - 0.5) arm(t)
          } else {
            const line = arr[a]
            if (t >= line.end) {
              if (repeatRef.current) {
                v.seek(line.start)
              } else if (autoPauseRef.current) {
                v.pause()
                v.seek(Math.max(line.start, line.end - 0.02))
                pausedAtEndRef.current = a
              } else {
                armedRef.current = c >= 0 && t >= arr[c].end ? c + 1 : c
              }
            }
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [indexAt, arm])

  const seekTo = useCallback(
    (t: number, andPlay = false) => {
      const v = videoRef.current
      if (!v) return
      const clamped = Math.max(0, Math.min(t, v.duration || t))
      arm(clamped)
      v.seek(clamped)
      if (andPlay) v.play()
    },
    [arm],
  )

  const playLine = useCallback(
    (i: number) => {
      const arr = linesRef.current
      if (!arr.length) return
      const idx = Math.max(0, Math.min(i, arr.length - 1))
      seekTo(arr[idx].start, true)
    },
    [seekTo],
  )

  const currentNav = useCallback(() => {
    const v = videoRef.current
    return v ? indexAt(v.currentTime) : -1
  }, [indexAt])

  const prevLine = useCallback(() => playLine(Math.max(0, currentNav() - 1)), [playLine, currentNav])
  const nextLine = useCallback(() => playLine(currentNav() + 1), [playLine, currentNav])
  const repeatLine = useCallback(() => playLine(Math.max(0, currentNav())), [playLine, currentNav])

  /** Suspend auto-pause / repeat (e.g. while the capture replays a line). Returns the release function, which re-arms at the playhead. */
  const hold = useCallback(() => {
    holdRef.current++
    let released = false
    return () => {
      if (released) return
      released = true
      holdRef.current--
      const v = videoRef.current
      if (v && holdRef.current === 0) arm(v.currentTime)
    }
  }, [arm])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play()
    else v.pause()
  }, [])

  // Transport events -> React state. Re-subscribed whenever the transport instance changes.
  useEffect(() => {
    if (!transport) return
    setDuration(transport.duration || 0)
    setPlaying(!transport.paused)
    const offs = [
      transport.on('ready', () => {
        setDuration(transport.duration || 0)
        transport.setRate(rateRef.current)
      }),
      transport.on('play', () => {
        setPlaying(true)
        setDuration(transport.duration || 0)
        const a = armedRef.current
        if (pausedAtEndRef.current >= 0 && pausedAtEndRef.current === a) armedRef.current = a + 1
        pausedAtEndRef.current = -1
      }),
      transport.on('pause', () => setPlaying(false)),
      transport.on('ended', () => setPlaying(false)),
    ]
    return () => offs.forEach((off) => off())
  }, [transport])

  const rateRef = useRef(rate)
  rateRef.current = rate
  useEffect(() => {
    videoRef.current?.setRate(rate)
  }, [rate])

  useEffect(() => {
    if (!keyboardEnabled) return
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          prevLine()
          break
        case 'ArrowRight':
          e.preventDefault()
          nextLine()
          break
        case 'ArrowUp':
          e.preventDefault()
          repeatLine()
          break
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 'a':
        case 'A':
          setAutoPause((x) => !x)
          break
        case 'r':
        case 'R':
          setRepeat((x) => !x)
          break
        case 'm':
        case 'M':
          onMineRef.current?.()
          break
        case 'u':
        case 'U':
          onQuickUpdateRef.current?.()
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [keyboardEnabled, prevLine, nextLine, repeatLine, togglePlay])

  const subscribeTime = useCallback((fn: (t: number) => void) => {
    timeListeners.current.add(fn)
    const v = videoRef.current
    if (v) fn(v.currentTime)
    return () => {
      timeListeners.current.delete(fn)
    }
  }, [])

  return {
    subscribeTime,
    duration,
    playing,
    activeIndex,
    shifted,
    autoPause,
    setAutoPause,
    repeat,
    setRepeat,
    rate,
    setRate,
    seekTo,
    playLine,
    prevLine,
    nextLine,
    repeatLine,
    togglePlay,
    currentNav,
    hold,
  }
}

export type Player = ReturnType<typeof usePlayer>

/**
 * Current playhead time, throttled to ~12 updates/s.
 * Call this only in the small component that displays it (seek bar / clock), so the
 * lyrics list and controls don't re-render on every tick.
 */
export function usePlayerTime(player: Pick<Player, 'subscribeTime'>) {
  const [time, setTime] = useState(0)
  useEffect(() => player.subscribeTime(setTime), [player.subscribeTime])
  return time
}
