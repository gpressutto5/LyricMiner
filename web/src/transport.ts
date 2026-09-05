/**
 * The minimal playback surface the line-stepping logic needs. Implemented by the YouTube IFrame
 * wrapper today; a plain <video> element could implement it too.
 */
export interface Transport {
  readonly currentTime: number
  readonly duration: number
  readonly paused: boolean
  readonly rate: number
  play(): void
  pause(): void
  seek(t: number): void
  setRate(r: number): void
}

export type TransportEvent = 'play' | 'pause' | 'ended' | 'ready' | 'error'

export interface EventedTransport extends Transport {
  on(event: TransportEvent, fn: (detail?: unknown) => void): () => void
}
