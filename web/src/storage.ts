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
}

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
