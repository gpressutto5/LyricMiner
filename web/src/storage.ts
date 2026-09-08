export interface Settings {
  deck: string
  model: string
  sentenceField: string
  audioField: string
  imageField: string
  sourceField: string
  tags: string
  songTagTemplate: string
  padStart: number
  padEnd: number
  fontSize: number
  /** Poll AnkiConnect for cards made in the deck while mining, so Yomitan cards get enriched without pressing U. */
  autoDetect: boolean
  /** What to do with a detected card: enrich it straight away, or open the mining dialog for a look first. */
  autoDetectAction: AutoDetectAction
}

export type AutoDetectAction = 'dialog' | 'update'

export const DEFAULT_SETTINGS: Settings = {
  deck: '',
  model: '',
  sentenceField: 'Sentence',
  audioField: 'SentenceAudio',
  imageField: 'Picture',
  sourceField: '',
  tags: 'lyricminer',
  songTagTemplate: 'Song::{title}',
  padStart: 0,
  padEnd: 0,
  fontSize: 28,
  autoDetect: false,
  autoDetectAction: 'update',
}

const SETTINGS_KEY = 'lyricminer.settings'

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

export interface SavedLyrics {
  lrc: string
  offset: number
  label: string
}

export function loadLyrics(id: string): SavedLyrics | null {
  try {
    const raw = localStorage.getItem(`lyricminer.lyrics.${id}`)
    return raw ? (JSON.parse(raw) as SavedLyrics) : null
  } catch {
    return null
  }
}

export function saveLyrics(id: string, l: SavedLyrics | null) {
  try {
    if (l) localStorage.setItem(`lyricminer.lyrics.${id}`, JSON.stringify(l))
    else localStorage.removeItem(`lyricminer.lyrics.${id}`)
  } catch {
    /* ignore */
  }
}

const SETUP_KEY = 'lyricminer.setupDone'

export function isSetupDone(): boolean {
  try {
    return localStorage.getItem(SETUP_KEY) === '1'
  } catch {
    return true
  }
}

export function markSetupDone() {
  try {
    localStorage.setItem(SETUP_KEY, '1')
  } catch {
    /* ignore */
  }
}
