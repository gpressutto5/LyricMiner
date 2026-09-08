import { useEffect, useRef } from 'react'
import { findRecentNoteIds, notesInfo, type NoteInfo } from './anki'
import type { LyricLine } from './lrc'
import type { Settings } from './storage'

/**
 * Notice cards Yomitan (or anything else) adds to the mining deck, the way GameSentenceMiner does: poll
 * AnkiConnect for notes added recently, diff against what was already seen, and hand each new one to the
 * caller. AnkiConnect has no push channel, so polling is the only option a static site has; the query is
 * scoped to one deck and a short window so each tick is a single cheap indexed lookup.
 */

/** How often to ask Anki for new notes while active. */
export const POLL_MS = 1000
/** Polls fail over to this cadence while Anki is unreachable. */
const BACKOFF_MS = 5000
/** Only notes younger than this count as "new". Also bounds the set of ids remembered between ticks. */
export const RECENT_MS = 30_000
/** Polling stops when nothing has happened (no input, no playback) for this long. Pausing alone never stops it. */
export const IDLE_MS = 60_000

/** Strip everything that varies between a lyric line and the same text copied out of the page by Yomitan. */
export function normalizeText(t: string) {
  return t
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[、。，．,.!?！？…‥「」『』（）()［］\[\]〈〉《》【】"'“”‘’・♪〜~\-–—/]/g, '')
}

/**
 * Which lyric line a note's sentence came from, or -1. The sentence usually equals one line, but Yomitan can
 * take part of a line or spill into the next, so containment in either direction counts. Choruses repeat, so
 * among equally good matches the one nearest `nearIndex` (the playhead) wins.
 */
export function matchLine(sentence: string, lines: LyricLine[], nearIndex: number): number {
  const s = normalizeText(sentence)
  if (s.length < 2) return -1
  let best = -1
  let bestScore = -Infinity
  lines.forEach((line, i) => {
    const l = normalizeText(line.text)
    if (l.length < 2) return
    let score: number
    if (l === s) score = 3
    else if (s.includes(l)) score = 2 + l.length / s.length
    else if (l.includes(s)) score = 1 + s.length / l.length
    else return
    // Distance to the playhead only breaks ties between otherwise equal matches.
    score -= Math.abs(i - nearIndex) / (lines.length * 10 + 1)
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  })
  return best
}

const CLAIM_KEY = 'lyricminer.claimedNotes'
const CLAIM_TTL_MS = 60 * 60 * 1000

/** Mark a note as handled by this browser so a second LyricMiner tab does not enrich it as well. False if already taken. */
export function claimNote(id: number): boolean {
  try {
    const now = Date.now()
    const raw = localStorage.getItem(CLAIM_KEY)
    const claims: Record<string, number> = raw ? JSON.parse(raw) : {}
    for (const k of Object.keys(claims)) if (now - claims[k] > CLAIM_TTL_MS) delete claims[k]
    if (claims[id]) return false
    claims[id] = now
    localStorage.setItem(CLAIM_KEY, JSON.stringify(claims))
    return true
  } catch {
    return true
  }
}

export type DetectorStatus = 'idle' | 'polling' | 'unreachable'

interface DetectorOptions {
  enabled: boolean
  settings: Settings
  /** Playback counts as activity, so a song playing on its own keeps detection alive. */
  playing: boolean
  onNote: (note: NoteInfo) => void
  onStatus?: (status: DetectorStatus) => void
}

/**
 * Poll for new notes while enabled, the tab is visible, and the user or the player has been active recently.
 * Every (re)start re-seeds the baseline, so a card made while the page was idle or hidden is left alone;
 * it was not mined from here, and "update last card" is still there for it.
 */
export function useNewCardDetector({ enabled, settings, playing, onNote, onStatus }: DetectorOptions) {
  const onNoteRef = useRef(onNote)
  onNoteRef.current = onNote
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus
  const lastActivity = useRef(Date.now())
  const playingRef = useRef(playing)
  playingRef.current = playing
  const bumpRef = useRef<() => void>(() => {})
  // Playback starting is activity too, and must wake a poller that went idle.
  useEffect(() => {
    if (playing) bumpRef.current()
  }, [playing])

  const deck = settings.deck
  const sentenceField = settings.sentenceField

  useEffect(() => {
    if (!enabled || !deck) {
      onStatusRef.current?.('idle')
      return
    }
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let seen: Set<number> | null = null // null = baseline not seeded yet
    let inFlight = false
    const s: Settings = { ...settings, deck, sentenceField }

    const bump = () => {
      lastActivity.current = Date.now()
      if (timer === null && !inFlight && !stopped) schedule(0)
    }
    bumpRef.current = bump
    const active = () => document.visibilityState === 'visible' && (playingRef.current || Date.now() - lastActivity.current < IDLE_MS)

    const schedule = (ms: number) => {
      if (stopped) return
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(tick, ms)
    }

    const tick = async () => {
      timer = null
      if (stopped) return
      if (!active()) {
        // Go quiet; the next input or visibility change starts a fresh baseline.
        seen = null
        onStatusRef.current?.('idle')
        return
      }
      if (inFlight) return schedule(POLL_MS)
      inFlight = true
      try {
        const ids = await findRecentNoteIds(s, RECENT_MS)
        if (stopped) return
        onStatusRef.current?.('polling')
        if (seen === null) {
          seen = new Set(ids)
        } else {
          const fresh = ids.filter((id) => !seen!.has(id)).sort((a, b) => a - b)
          seen = new Set(ids)
          const mine = fresh.filter(claimNote)
          if (mine.length) {
            const infos = await notesInfo(mine)
            if (stopped) return
            for (const info of infos) onNoteRef.current(info)
          }
        }
        schedule(POLL_MS)
      } catch {
        if (stopped) return
        onStatusRef.current?.('unreachable')
        seen = null
        schedule(BACKOFF_MS)
      } finally {
        inFlight = false
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') bump()
    }
    const events = ['pointerdown', 'keydown', 'wheel'] as const
    for (const e of events) window.addEventListener(e, bump, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    bump()

    return () => {
      stopped = true
      bumpRef.current = () => {}
      if (timer !== null) clearTimeout(timer)
      for (const e of events) window.removeEventListener(e, bump)
      document.removeEventListener('visibilitychange', onVisibility)
      onStatusRef.current?.('idle')
    }
    // Only the parts of settings the query depends on should restart the poller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, deck, sentenceField])
}
