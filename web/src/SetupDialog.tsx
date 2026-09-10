import { useEffect, useState, type ReactNode } from 'react'
import { Check, Copy, Disc3, ExternalLink, Link2, Sparkles, X, type LucideIcon } from 'lucide-react'
import { cn } from 'cn'
import { ankiAlive } from './anki'
import { captureSupported } from './capture'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { SectionLabel } from './components/primitives'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called when the user dismisses the dialog with the footer button (marks setup as seen). */
  onDone: () => void
}

const ANKICONNECT_URL = 'https://ankiweb.net/shared/info/2055492159'

/**
 * First-run dialog. Two parts: the one thing that needs doing up front (get AnkiConnect to accept
 * this origin, polled live so the section collapses the moment Anki answers) and a short picture
 * of how mining works, shown regardless so skipping Anki doesn't skip the explanation.
 */
export function SetupDialog({ open, onOpenChange, onDone }: Props) {
  const [anki, setAnki] = useState<boolean | null>(null)
  const origin = location.origin
  const capture = captureSupported()

  useEffect(() => {
    if (!open) return
    let alive = true
    const tick = () => ankiAlive().then((ok) => alive && setAnki(ok))
    tick()
    const i = setInterval(tick, 2000)
    return () => {
      alive = false
      clearInterval(i)
    }
  }, [open])

  const configLine = `"webCorsOriginList": ["http://localhost", "${origin}"]`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] flex-col gap-7 overflow-y-auto rounded-3xl border-0 p-7 shadow-dialog sm:max-w-[580px]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <DialogTitle className="text-xl font-extrabold tracking-[-0.3px]">Set up LyricMiner</DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed font-medium text-muted">
              Everything runs in this tab. One thing to do first, then a quick look at how mining works.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              aria-label="Close"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-soft text-ink hover:bg-line-soft"
            >
              <X className="size-3.5" strokeWidth={2.5} />
            </button>
          </DialogClose>
        </div>

        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <SectionLabel>Connect Anki</SectionLabel>
            <span className="inline-flex items-center gap-2 text-xs font-bold text-muted">
              <span className={cn('size-2 rounded-full', anki === null ? 'bg-faint' : anki ? 'bg-ok' : 'animate-pulse bg-coral')} />
              {anki === null ? 'Checking…' : anki ? 'Connected' : 'Waiting for Anki…'}
            </span>
          </div>

          {anki ? (
            <div className="flex items-center gap-3 rounded-2xl bg-ok-tint px-4 py-3.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ok text-white">
                <Check className="size-3.5" strokeWidth={3} />
              </span>
              <span className="text-[13px] leading-relaxed font-medium text-ok-text">
                Anki accepts cards from this site. Keep it open while you mine; cards go straight to it from this tab.
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-4 rounded-2xl border border-line p-5">
              <p className="text-[13px] leading-relaxed font-medium text-ink-2">
                Cards go straight from this tab to Anki on this computer. Anki only accepts them once you allow this site, a one-time change.
              </p>
              <ol className="flex flex-col gap-3.5">
                <StepRow n={1}>
                  Install the{' '}
                  <a
                    href={ANKICONNECT_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-bold text-coral-text hover:text-coral-deep"
                  >
                    AnkiConnect add-on <ExternalLink className="size-3" />
                  </a>{' '}
                  and restart Anki.
                </StepRow>
                <StepRow n={2}>
                  In Anki open <b>Tools → Add-ons</b>, pick AnkiConnect, click <b>Config</b>.
                </StepRow>
                <StepRow n={3}>
                  <span>
                    Add this site to <code className="rounded bg-soft px-1.5 py-0.5 font-mono text-xs font-bold text-ink">webCorsOriginList</code>, save,
                    restart Anki.
                  </span>
                  <div className="mt-2.5 flex items-center gap-2">
                    <code className="flex h-11 flex-1 items-center overflow-x-auto rounded-xl bg-ink px-3.5 font-mono text-[13px] font-bold text-white">
                      {origin}
                    </code>
                    <CopyButton text={origin} label="Copy site address" />
                  </div>
                  <CopyLink text={configLine}>Copy the whole line instead</CopyLink>
                </StepRow>
              </ol>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <SectionLabel>How mining works</SectionLabel>
          <div className="flex flex-col divide-y divide-line-soft rounded-2xl border border-line">
            <HowRow icon={Link2} title="Open a song">
              Paste a YouTube link into the search box. Or use the bookmarklet from the home page on any YouTube video.
            </HowRow>
            <HowRow icon={Disc3} title="Record this tab">
              Press <b>Start capture</b> and share <b>this tab</b> with tab audio on. That is how the song's sound reaches your cards. The recording is saved
              only in your browser and never leaves it.
            </HowRow>
            <HowRow icon={Sparkles} title="Mine a line">
              Make a card with Yomitan on any line, then press <b>U</b> to add that line's audio, image and sentence to it.
            </HowRow>
          </div>
          {!capture && (
            <p className="rounded-xl bg-bad-tint px-3.5 py-3 text-[13px] leading-relaxed font-semibold text-bad-text">
              This browser can't record tab audio, so cards won't get audio or images here. Chrome and Edge can.
            </p>
          )}
        </section>

        <div className="flex justify-end">
          <Button onClick={onDone} className="h-11 rounded-[14px] px-5 font-bold">
            {anki ? 'Start mining' : 'Done'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StepRow({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className="mt-px flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-extrabold text-white">{n}</span>
      <div className="min-w-0 flex-1 text-[14px] leading-relaxed font-medium text-ink-2">{children}</div>
    </li>
  )
}

function HowRow({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-4 px-5 py-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-coral-tint text-coral-deep">
        <Icon className="size-4" strokeWidth={2.25} />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[14px] font-bold text-ink">{title}</span>
        <span className="text-[13px] leading-relaxed font-medium text-muted">{children}</span>
      </div>
    </div>
  )
}

function useCopy(text: string) {
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
  return { done, copy }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { done, copy } = useCopy(text)
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      title={label}
      className={cn(
        'flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-card text-ink hover:bg-soft',
        done && 'border-ok text-ok-text',
      )}
    >
      {done ? <Check className="size-4" strokeWidth={2.5} /> : <Copy className="size-4" />}
    </button>
  )
}

function CopyLink({ text, children }: { text: string; children: ReactNode }) {
  const { done, copy } = useCopy(text)
  return (
    <button type="button" onClick={copy} className={cn('mt-2 text-xs font-bold', done ? 'text-ok-text' : 'text-coral-text hover:text-coral-deep')}>
      {done ? 'Copied' : children}
    </button>
  )
}
