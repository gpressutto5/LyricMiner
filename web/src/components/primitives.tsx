import type { ReactNode } from 'react'
import { cn } from 'cn'
import { Minus, Plus } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** Keyboard hint rendered inside pills and buttons. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('text-[11px] font-bold text-faint', className)}>{children}</span>
}

/** Boxed key used in the shortcut strips. */
export function Key({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-md border border-line bg-card px-1.5 text-xs font-bold text-ink">
      {children}
    </span>
  )
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('text-xs font-extrabold tracking-[0.8px] text-coral-text uppercase', className)}>
      {children}
    </span>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-[20px] border border-line bg-card shadow-card', className)}>{children}</div>
}

interface PillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  on?: boolean
  kbd?: string
}

/** Toggle chip (Auto-pause, Repeat). */
export function Pill({ on, kbd, className, children, ...rest }: PillProps) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold transition-colors disabled:opacity-50',
        on ? 'bg-coral-tint text-coral-deep' : 'bg-soft text-ink-2 hover:bg-line-soft',
        className,
      )}
      {...rest}
    >
      <span>{children}</span>
      {kbd && <Kbd className={on ? 'text-coral-text/80' : undefined}>{kbd}</Kbd>}
    </button>
  )
}

interface RoundButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  size?: 'sm' | 'md' | 'lg'
  tone?: 'soft' | 'accent' | 'outline' | 'ink'
}

/** Circular icon button with a tooltip. */
export function RoundButton({ label, size = 'md', tone = 'soft', className, children, ...rest }: RoundButtonProps) {
  const dims = size === 'lg' ? 'size-14 [&_svg]:size-[22px]' : size === 'sm' ? 'size-8 [&_svg]:size-3.5' : 'size-11 [&_svg]:size-[18px]'
  const tones = {
    soft: 'bg-soft text-ink hover:bg-line-soft',
    accent: 'bg-coral text-white shadow-play hover:bg-coral-deep',
    outline: 'bg-card border border-line text-ink hover:bg-soft',
    ink: 'bg-ink text-white hover:bg-ink-2',
  }[tone]
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40 disabled:hover:bg-soft',
            dims,
            tones,
            className,
          )}
          {...rest}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent className="rounded-lg bg-ink font-semibold text-white">{label}</TooltipContent>
    </Tooltip>
  )
}

interface StepperProps {
  value: ReactNode
  onDec: () => void
  onInc: () => void
  decLabel?: string
  incLabel?: string
  className?: string
  valueClassName?: string
}

/** Pill with − / + around a value. */
export function Stepper({ value, onDec, onInc, decLabel = 'Decrease', incLabel = 'Increase', className, valueClassName }: StepperProps) {
  return (
    <div className={cn('inline-flex h-8 items-center rounded-full bg-soft px-1', className)}>
      <button type="button" aria-label={decLabel} onClick={onDec} className="flex size-[26px] items-center justify-center rounded-full bg-card text-ink hover:bg-line-soft">
        <Minus className="size-[11px]" strokeWidth={2.5} />
      </button>
      <span className={cn('min-w-[68px] px-1 text-center text-[13px] font-bold text-ink tabular-nums', valueClassName)}>{value}</span>
      <button type="button" aria-label={incLabel} onClick={onInc} className="flex size-[26px] items-center justify-center rounded-full bg-card text-ink hover:bg-line-soft">
        <Plus className="size-[11px]" strokeWidth={2.5} />
      </button>
    </div>
  )
}

/** Small status chip: green when ok, red when not. */
export function StatusChip({ ok, children, className }: { ok: boolean | null; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center gap-1.5 rounded-md px-2 text-[11px] font-bold',
        ok === null ? 'bg-soft text-muted' : ok ? 'bg-ok-tint text-ok-text' : 'bg-bad-tint text-bad-text',
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', ok === null ? 'bg-faint' : ok ? 'bg-ok' : 'bg-bad')} />
      {children}
    </span>
  )
}

/** Quiet support link: Buy Me a Coffee's cup and wording, without the loud yellow button. */
export function BuyMeACoffee({ className }: { className?: string }) {
  return (
    <a
      href="https://www.buymeacoffee.com/gpressutto5"
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-semibold text-faint transition-colors hover:bg-soft hover:text-ink-2',
        className,
      )}
    >
      <CoffeeCup className="size-4 text-[#B59700]" />
      Buy me a coffee
    </a>
  )
}

/** Buy Me a Coffee's cup mark. */
function CoffeeCup({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4.2 7.2h11.6l-1 9.1a2.4 2.4 0 0 1-2.4 2.1H7.6a2.4 2.4 0 0 1-2.4-2.1z" />
      <path d="M16 9.4h1.4a2.5 2.5 0 0 1 0 5h-.9" />
      <path d="M5.4 21h9.6" />
      <path d="M9 4.6c.7-.7.7-1.4 0-2.1M12.6 4.6c.7-.7.7-1.4 0-2.1" />
    </svg>
  )
}
