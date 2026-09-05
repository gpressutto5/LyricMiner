export interface SearchResult {
  id: string
  title: string
  channel: string
  duration: number | null
  thumbnail: string
}

export interface TrackInfo {
  id: string
  title: string
  channel: string
  track?: string
  artist?: string
  album?: string
  duration: number
  thumbnail: string
  url: string
  ready: boolean
}

export type JobState = 'idle' | 'downloading' | 'ready' | 'error'

export interface JobStatus {
  state: JobState
  progress: number
  phase: string
  error?: string
}

export interface LyricsResult {
  id: number
  trackName: string
  artistName: string
  albumName: string
  duration: number
  instrumental: boolean
  syncedLyrics: string | null
  plainLyrics: string | null
}

export interface Health {
  ytdlp: string | null
  ffmpeg: boolean
  anki: boolean
}
