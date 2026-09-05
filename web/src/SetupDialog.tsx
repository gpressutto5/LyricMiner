import { useEffect, useState, type ReactNode } from 'react'
import { Check, Copy, ExternalLink, X } from 'lucide-react'
import { cn } from 'cn'
import { ankiAlive } from './anki'
import { captureSupported } from './capture'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { SectionLabel, StatusChip } from './components/primitives'
import { Bookmarklet } from './SearchView'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called when the user dismisses the dialog with "Done" (marks setup as seen). */
  onDone: () => void
}

const ANKICONNECT_URL = 'https://ankiweb.net/shared/info/2055492159'

/**
 * First-run guide for the two permissions the static site needs: AnkiConnect's CORS allow-list
 * and Chrome's tab-share prompt. Also shows how to get songs in (paste a link / bookmarklet).
 */
export function SetupDialog({ open, onOpenChange, onDone }: Props) {
  const [anki, setAnki] = useState<boolean | null>(null)
  const origin = location.origin
  const capture = captureSupported()

  // Poll while open so the chip flips green as soon as the user has fixed the config.
  useEffect(() => {
    if (!open) return
    let alive = true
    const tick = () => ankiAlive().then((ok) => alive && setAnki(ok))
    tick()
    const i = setInterval(tick, 2500)
    return () => {
      alive = false
      clearInterval(i)
    }
  }, [open])

  const configSnippet = `"webCorsOriginList": [\n    "http://localhost",\n    "${origin}"\n]`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="flex max-h-[92vh] flex-col gap-6 overflow-y-auto rounded-3xl border-0 p-7 shadow-dialog sm:max-w-[720px]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <DialogTitle className="text-xl font-extrabold tracking-[-0.3px]">Set up LyricMiner</DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed font-medium text-muted">
              Everything runs in this tab. Two one-time permissions let it talk to Anki and record the song you're listening to.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <button type="button" aria-label="Close" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-soft text-ink hover:bg-line-soft">
              <X className="size-3.5" strokeWidth={2.5} />
            </button>
          </DialogClose>
        </div>

        <Step
          n={1}
          title="Let Anki accept cards from this site"
          status={<StatusChip ok={anki}>{anki === null ? 'Checking…' : anki ? 'Anki connected' : 'Not connected'}</StatusChip>}
        >
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-[13px] leading-relaxed font-medium text-ink-2">
            <li>
              Install the{' '}
              <a href={ANKICONNECT_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-coral-text hover:text-coral-deep">
                AnkiConnect add-on <ExternalLink className="size-3" />
              </a>{' '}
              (code <code className="rounded bg-soft px-1.5 py-0.5 font-mono text-xs font-bold text-ink">2055492159</code>) and restart Anki.
            </li>
            <li>
              In Anki open <b>Tools → Add-ons</b>, select AnkiConnect and click <b>Config</b>.
            </li>
            <li>
              Add this site to <code className="rounded bg-soft px-1.5 py-0.5 font-mono text-xs font-bold text-ink">webCorsOriginList</code>, save, and restart Anki:
            </li>
          </ol>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <code className="flex h-10 flex-1 items-center rounded-xl bg-ink px-3.5 font-mono text-[13px] font-bold text-white">{origin}</code>
              <CopyButton text={origin} label="Copy origin" />
            </div>
            <details className="group text-[13px]">
              <summary className="cursor-pointer list-none font-bold text-coral-text hover:text-coral-deep">
                <span className="group-open:hidden">Show the full config line</span>
                <span className="hidden group-open:inline">Full config line</span>
              </summary>
              <div className="mt-2 flex items-start gap-2">
                <pre className="flex-1 overflow-x-auto rounded-xl bg-soft px-3.5 py-3 font-mono text-xs leading-relaxed font-semibold text-ink">{configSnippet}</pre>
                <CopyButton text={configSnippet} label="Copy config" />
              </div>
            </details>
          </div>
          <p className="text-xs leading-relaxed font-medium text-faint">
            Anki has to be running while you mine. This page talks to it directly at 127.0.0.1:8765; nothing goes through a server.
          </p>
        </Step>

        <Step
          n={2}
          title="Allow recording this tab"
          status={<StatusChip ok={capture}>{capture ? 'Supported' : 'Not in this browser'}</StatusChip>}
        >
          {capture ? (
            <p className="text-[13px] leading-relaxed font-medium text-ink-2">
              Songs play through YouTube, so the audio for your cards is recorded from this tab while you listen. When you press{' '}
              <b>Start capture</b> on a song, the browser asks which tab to share: pick <b>this tab</b> and keep <b>“Also share tab audio”</b>{' '}
              ticked. The recording stays in your browser. Lines become mineable once you've heard them at normal speed.
            </p>
          ) : (
            <p className="text-[13px] leading-relaxed font-medium text-bad-text">
              This browser can't record tab audio, so you can read and step through lyrics here but not add audio or images to cards.
              Chrome and Edge support it.
            </p>
          )}
        </Step>

        <Step n={3} title="Getting songs in">
          <p className="text-[13px] leading-relaxed font-medium text-ink-2">
            A website can't search YouTube for you, so find the song on YouTube and paste its link into the search box. Or drag this
            bookmarklet to your bookmarks bar and click it while watching any video:
          </p>
          <Bookmarklet />
        </Step>

        <div className="flex justify-end pt-1">
          <Button onClick={onDone} className="h-11 rounded-[14px] px-5 font-bold">
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Step({ n, title, status, children }: { n: number; title: string; status?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line p-5">
      <div className="flex items-center gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-extrabold text-white">{n}</span>
        <SectionLabel className="flex-1 normal-case tracking-normal text-[15px] text-ink">{title}</SectionLabel>
        {status}
      </div>
      {children}
    </section>
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 1500)
    } catch {
      /* clipboard blocked; the text is visible to select anyway */
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      title={label}
      className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl border border-line bg-card text-ink hover:bg-soft', done && 'border-ok text-ok-text')}
    >
      {done ? <Check className="size-4" strokeWidth={2.5} /> : <Copy className="size-4" />}
    </button>
  )
}
