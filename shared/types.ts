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
