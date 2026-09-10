import { useCallback, useEffect, useState } from 'react'
import { Search, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { ankiAlive } from './anki'
import { parseYouTubeId } from './api'
import { SearchView } from './SearchView'
import { SettingsDialog } from './SettingsDialog'
import { SetupDialog } from './SetupDialog'
import { TrackView } from './TrackView'
import { captureSupported } from './capture'
import { isSetupDone, loadSettings, markSetupDone, saveSettings, type Settings } from './storage'

export type ToastKind = 'ok' | 'bad' | 'info'
export type ToastFn = (text: string, kind?: ToastKind) => void

export interface SearchRequest {
  q: string
  /** Bumped on every submit so the same query can be re-run. */
  nonce: number
}

export default function App() {
  const [trackId, setTrackId] = useState<string | null>(() => new URLSearchParams(location.search).get('v'))
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [anki, setAnki] = useState<boolean | null>(null)
  const [setupOpen, setSetupOpen] = useState(() => !isSetupDone())
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<SearchRequest>({ q: '', nonce: 0 })

  // Ping AnkiConnect directly; pause while the setup dialog polls on its own.
  useEffect(() => {
    if (setupOpen) return
    let alive = true
    const tick = () => ankiAlive().then((ok) => alive && setAnki(ok))
    tick()
    const i = setInterval(tick, 10000)
    return () => {
      alive = false
      clearInterval(i)
    }
  }, [setupOpen])

  const finishSetup = () => {
    markSetupDone()
    setSetupOpen(false)
  }

  useEffect(() => {
    const u = new URL(location.href)
    if (trackId) u.searchParams.set('v', trackId)
    else u.searchParams.delete('v')
    history.replaceState(null, '', u)
  }, [trackId])

  const showToast = useCallback<ToastFn>((text, kind = 'info') => {
    if (kind === 'ok') toast.success(text)
    else if (kind === 'bad') toast.error(text, { duration: 6000 })
    else toast(text)
  }, [])

  const updateSettings = (s: Settings) => {
    setSettings(s)
    saveSettings(s)
  }

  const openTrack = (id: string) => {
    setQuery('')
    setTrackId(id)
  }

  /** Back to the library: no track, no pending search. */
  const goHome = () => {
    setTrackId(null)
    setQuery('')
    setSearch((s) => ({ q: '', nonce: s.nonce }))
  }

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const text = query.trim()
    if (!text) return
    const direct = parseYouTubeId(text)
    if (direct) return openTrack(direct)
    setTrackId(null)
    setSearch((s) => ({ q: text, nonce: s.nonce + 1 }))
  }

  const capture = captureSupported()
  const failing = anki === null ? [] : [!anki && 'Anki', !capture && 'Tab capture'].filter(Boolean)
  const statusTone = anki === null ? 'bg-soft text-muted' : failing.length ? 'bg-bad-tint text-bad-text' : 'bg-ok-tint text-ok-text'
  const statusDot = anki === null ? 'bg-faint' : failing.length ? 'bg-bad' : 'bg-ok'
  const statusText = anki === null ? 'Checking Anki…' : failing.length ? `${failing.join(' · ')} unavailable` : 'Anki · Tab capture'
  const statusTitle = `Anki: ${anki ? 'connected' : 'not reachable (is Anki open and this site allowed?)'}\nTab capture: ${capture ? 'supported' : 'not supported in this browser (use Chrome or Edge)'}\n\nClick for setup help`

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      <header className="flex h-[68px] shrink-0 items-center justify-between gap-6 px-7">
        <button type="button" onClick={goHome} className="flex items-center gap-2.5 text-xl font-extrabold tracking-[-0.3px]">
          <span className="size-3 rounded-full bg-coral" />
          <span>LyricMiner</span>
        </button>

        <form onSubmit={submitSearch} className="group flex h-11 w-[520px] max-w-[45vw] items-center gap-2.5 rounded-full border border-line bg-card pr-1.5 pl-[18px] text-ink transition-[box-shadow,border-color] focus-within:border-coral focus-within:shadow-[0_0_0_4px_rgba(224,100,77,0.12)]">
          <Search className="size-4 shrink-0 text-faint" />
          <input
            type="search"
            autoFocus={!trackId}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Paste a YouTube link"
            className="min-w-0 flex-1 bg-transparent font-semibold outline-none placeholder:font-medium placeholder:text-faint"
          />
          <button
            type="submit"
            className={cn(
              'h-8 shrink-0 rounded-full bg-ink px-3.5 text-[13px] font-bold text-white transition-opacity hover:bg-ink-2',
              query.trim() ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
          >
            Open
          </button>
        </form>

        <div className="flex items-center gap-3">
          <button
            type="button"
            title={statusTitle}
            onClick={() => setSetupOpen(true)}
            className={cn('inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold whitespace-nowrap hover:brightness-95', statusTone)}
          >
            <span className={cn('size-2 rounded-full', statusDot)} />
            {statusText}
          </button>
          <button
            type="button"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
            className="flex size-10 items-center justify-center rounded-full border border-line bg-card text-ink hover:bg-soft"
          >
            <SlidersHorizontal className="size-4" />
          </button>
        </div>
      </header>

      {trackId ? (
        <TrackView key={trackId} id={trackId} settings={settings} onSettings={updateSettings} toast={showToast} modalOpen={settingsOpen || setupOpen} />
      ) : (
        <SearchView request={search} onOpen={openTrack} onClear={goHome} />
      )}

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} onChange={updateSettings} />
      <SetupDialog open={setupOpen} onOpenChange={(o) => (o ? setSetupOpen(true) : finishSetup())} onDone={finishSetup} />
    </div>
  )
}
