import type { TrackInfo } from '../../shared/types'

const KEY = 'lyricminer.library'
const MAX = 60

/** Songs the user has opened, most recent first. Lives in localStorage since nothing is downloaded any more. */
export function loadLibrary(): TrackInfo[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as TrackInfo[]) : []
  } catch {
    return []
  }
}

function save(list: TrackInfo[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  } catch {
    /* ignore */
  }
}

export function rememberTrack(info: TrackInfo) {
  const rest = loadLibrary().filter((t) => t.id !== info.id)
  save([info, ...rest])
}

export function forgetTrack(id: string) {
  save(loadLibrary().filter((t) => t.id !== id))
}
