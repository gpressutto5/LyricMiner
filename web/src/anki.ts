import type { TrackInfo } from '../../shared/types'
import type { Settings } from './storage'

export const ANKI_URL = 'http://127.0.0.1:8765'

export const ANKI_UNREACHABLE =
  "Can't reach AnkiConnect. Make sure Anki is open with the AnkiConnect add-on, and that this site is listed in its webCorsOriginList (see Connect Anki in the header)."

/**
 * Call AnkiConnect straight from the browser. Browsers allow an https page to talk to 127.0.0.1, but
 * AnkiConnect only answers origins in its `webCorsOriginList`, so a network error usually means either
 * Anki is closed or this site has not been allowed yet.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function invoke<T = any>(action: string, params: Record<string, unknown> = {}, timeoutMs = 30000): Promise<T> {
  let r: Response
  try {
    r = await fetch(ANKI_URL, {
      method: 'POST',
      // text/plain keeps the request "simple" (no CORS preflight); AnkiConnect parses the body as JSON regardless.
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action, version: 6, params }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new Error(ANKI_UNREACHABLE)
  }
  const j = (await r.json()) as { result: T; error: string | null }
  if (j.error) throw new Error(j.error)
  return j.result
}

/** True when AnkiConnect answers this origin. */
export async function ankiAlive(): Promise<boolean> {
  try {
    await invoke('version', {}, 1500)
    return true
  } catch {
    return false
  }
}

/** A media file for AnkiConnect: inline base64, or a URL it downloads itself (no CORS involved). */
export type Media = { filename: string } & ({ data: string; url?: undefined } | { url: string; data?: undefined })

export interface CardPayload {
  sentence?: string
  source?: string
  tags?: string[]
  audio?: Media
  image?: Media
}

export interface NoteInfo {
  noteId: number
  modelName: string
  tags: string[]
  fields: Record<string, { value: string; order: number }>
}

function parseTags(raw: string) {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

/** Squash one value into a single PascalCase token: Anki tags can't contain spaces, and ":" would nest. */
function tagPart(raw: string) {
  return raw
    .replace(/["'`\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]/g, '')
    .split(/[\s_:/\\-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
}

/**
 * GameSentenceMiner-style hierarchical tag from a template, e.g.
 * "Song::{artist}:{title}" -> "Song::Yorushika:TheHitchhikersGuide".
 * Placeholders that resolve to nothing collapse, so a missing artist yields "Song::TheTitle"
 * rather than a dangling separator. Returns null when the template is empty or resolves to nothing.
 */
export function buildSongTag(track: Pick<TrackInfo, 'title' | 'channel' | 'track' | 'artist' | 'album'>, template: string): string | null {
  if (!template.trim()) return null
  const values: Record<string, string> = {
    artist: track.artist || track.channel || '',
    title: track.track || track.title || '',
    album: track.album || '',
    channel: track.channel || '',
  }
  let resolved = false
  const substituted = template.trim().replace(/\{(\w+)\}/g, (_, k: string) => {
    const part = tagPart(values[k] ?? '')
    if (part) resolved = true
    return part
  })
  // A template whose placeholders all came back empty would leave just the literal prefix ("Song"),
  // which says nothing about the track — skip it rather than tag every such card alike.
  if (!resolved && substituted !== template.trim()) return null
  return (
    substituted
      .split('::')
      .map((seg) => seg.split(':').filter(Boolean).join(':'))
      .filter(Boolean)
      .join('::') || null
  )
}

function allTags(payload: CardPayload, s: Settings) {
  return [...new Set([...parseTags(s.tags), ...(payload.tags ?? [])])]
}

function buildFields(payload: CardPayload, s: Settings, existing: string[] | null) {
  const has = (f: string) => !!f && (existing === null || existing.includes(f))
  const fields: Record<string, string> = {}
  const audio: (Media & { fields: string[] })[] = []
  const picture: (Media & { fields: string[] })[] = []
  const skipped: string[] = []

  if (payload.sentence !== undefined) {
    if (has(s.sentenceField)) fields[s.sentenceField] = payload.sentence
    else skipped.push(`sentence → "${s.sentenceField}"`)
  }
  if (payload.source !== undefined && s.sourceField) {
    if (has(s.sourceField)) fields[s.sourceField] = payload.source
    else skipped.push(`source → "${s.sourceField}"`)
  }
  if (payload.audio) {
    if (has(s.audioField)) {
      fields[s.audioField] = '' // AnkiConnect appends media refs, so clear stale content first.
      audio.push({ ...payload.audio, fields: [s.audioField] })
    } else skipped.push(`audio → "${s.audioField}"`)
  }
  if (payload.image) {
    if (has(s.imageField)) {
      fields[s.imageField] = ''
      picture.push({ ...payload.image, fields: [s.imageField] })
    } else skipped.push(`image → "${s.imageField}"`)
  }
  return { fields, audio, picture, skipped }
}

/** How far back "update last card" reaches. Anything older is almost certainly not the card you just made. */
export const UPDATE_WINDOW_MS = 10 * 60 * 1000

/** Quote a value for an Anki search. Inside quotes Anki still treats \\, ", * and _ specially. */
function quoteSearch(v: string) {
  return `"${v.replace(/[\\"*_]/g, (c) => `\\${c}`)}"`
}

function firstFieldText(info: NoteInfo) {
  const first = Object.values(info.fields).sort((a, b) => a.order - b.order)[0]?.value ?? ''
  return first.replace(/<[^>]+>/g, '').trim().slice(0, 40)
}

export interface LastCard {
  id: number
  /** First field as plain text, so the user can tell which note is about to be overwritten. */
  word: string
  modelName: string
  info: NoteInfo
}

/**
 * The note "update last card" would overwrite: the newest one added to the configured deck within
 * UPDATE_WINDOW_MS. Deck scoping and the time window keep an unrelated card made earlier today
 * (which `added:1` alone would happily match) out of reach.
 */
export async function findLastCard(s: Settings): Promise<LastCard> {
  const where = s.deck ? ` in ${s.deck}` : ''
  const ids = await invoke<number[]>('findNotes', {
    query: `added:1${s.deck ? ` deck:${quoteSearch(s.deck)}` : ''}`,
  })
  // Note ids are creation timestamps in ms, so recency costs no extra lookup.
  const cutoff = Date.now() - UPDATE_WINDOW_MS
  const recent = ids.filter((id) => id > cutoff)
  if (!recent.length) {
    const mins = Math.round(UPDATE_WINDOW_MS / 60000)
    throw new Error(
      ids.length
        ? `The newest card${where} was added more than ${mins} minutes ago, so there is nothing recent to update. Make the card first, or use "Add new card".`
        : `No card was added${where} in the last ${mins} minutes. Make the card first (e.g. in Yomitan), or use "Add new card".`,
    )
  }
  const id = Math.max(...recent)
  const [info] = await invoke<NoteInfo[]>('notesInfo', { notes: [id] })
  return toLastCard(info)
}

export function toLastCard(info: NoteInfo): LastCard {
  return { id: info.noteId, word: firstFieldText(info), modelName: info.modelName, info }
}

/**
 * Ids of notes added to the configured deck in the last `windowMs`. Anki's search can't go finer than
 * `added:1` (today), so the window is applied to the ids, which are creation timestamps in ms.
 */
export async function findRecentNoteIds(s: Settings, windowMs: number): Promise<number[]> {
  if (!s.deck) return []
  const ids = await invoke<number[]>('findNotes', { query: `added:1 deck:${quoteSearch(s.deck)}` }, 5000)
  const cutoff = Date.now() - windowMs
  return ids.filter((id) => id > cutoff)
}

export async function notesInfo(ids: number[]): Promise<NoteInfo[]> {
  if (!ids.length) return []
  return invoke<NoteInfo[]>('notesInfo', { notes: ids }, 5000)
}

/** The sentence a note was made from, as plain text (Yomitan wraps the scanned word in tags and may add cloze markup). */
export function noteSentence(info: NoteInfo, s: Settings): string {
  const raw = s.sentenceField ? info.fields[s.sentenceField]?.value ?? '' : ''
  return raw
    .replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

/** Like asbplayer's "update last card": enrich a note you just made (e.g. one Yomitan created). */
export async function updateCard(target: LastCard, payload: CardPayload, s: Settings) {
  const { fields, audio, picture, skipped } = buildFields(payload, s, Object.keys(target.info.fields))
  if (!Object.keys(fields).length && !audio.length && !picture.length) {
    throw new Error(`Note type "${target.modelName}" has none of the configured fields (${skipped.join(', ')}).`)
  }
  await invoke('updateNoteFields', {
    note: { id: target.id, fields, ...(audio.length ? { audio } : {}), ...(picture.length ? { picture } : {}) },
  })
  const tags = allTags(payload, s)
  if (tags.length) await invoke('addTags', { notes: [target.id], tags: tags.join(' ') })
  return { id: target.id, word: target.word, skipped }
}

export async function addCard(payload: CardPayload, s: Settings) {
  if (!s.deck || !s.model) throw new Error('Choose a deck and note type in Settings first.')
  const modelFields = await invoke<string[]>('modelFieldNames', { modelName: s.model })
  const { fields, audio, picture, skipped } = buildFields(payload, s, modelFields)
  // addNote requires the first field to be non-empty.
  if (!fields[modelFields[0]]) fields[modelFields[0]] = payload.sentence ?? payload.source ?? 'LyricMiner'
  const id = await invoke<number>('addNote', {
    note: {
      deckName: s.deck,
      modelName: s.model,
      fields,
      options: { allowDuplicate: true },
      tags: allTags(payload, s),
      ...(audio.length ? { audio } : {}),
      ...(picture.length ? { picture } : {}),
    },
  })
  return { id, skipped }
}
