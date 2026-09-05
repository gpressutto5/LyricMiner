import type { TrackInfo } from '../../shared/types'
import type { Settings } from './storage'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function invoke<T = any>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch('/api/anki', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params }),
  })
  const j = (await r.json()) as { result: T; error: string | null }
  if (j.error) throw new Error(j.error)
  return j.result
}

export interface Media {
  data: string // base64
  filename: string
}

export interface CardPayload {
  sentence?: string
  source?: string
  tags?: string[]
  audio?: Media
  image?: Media
}

interface NoteInfo {
  noteId: number
  modelName: string
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
export function buildSongTag(track: TrackInfo, template: string): string | null {
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
  const audio: { data: string; filename: string; fields: string[] }[] = []
  const picture: { data: string; filename: string; fields: string[] }[] = []
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

/** Like asbplayer's "update last card": enrich the most recently added note (e.g. one Yomitan just made). */
export async function updateLastCard(payload: CardPayload, s: Settings) {
  const ids = await invoke<number[]>('findNotes', { query: 'added:1' })
  if (!ids.length) throw new Error('No notes were added today, so there is no card to update.')
  const id = Math.max(...ids)
  const [info] = await invoke<NoteInfo[]>('notesInfo', { notes: [id] })
  const existing = Object.keys(info.fields)
  const { fields, audio, picture, skipped } = buildFields(payload, s, existing)
  if (!Object.keys(fields).length && !audio.length && !picture.length) {
    throw new Error(`Note type "${info.modelName}" has none of the configured fields (${skipped.join(', ')}).`)
  }
  await invoke('updateNoteFields', {
    note: { id, fields, ...(audio.length ? { audio } : {}), ...(picture.length ? { picture } : {}) },
  })
  const tags = allTags(payload, s)
  if (tags.length) await invoke('addTags', { notes: [id], tags: tags.join(' ') })
  const first = Object.values(info.fields).sort((a, b) => a.order - b.order)[0]?.value ?? ''
  return { id, word: first.replace(/<[^>]+>/g, '').slice(0, 40), skipped }
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
