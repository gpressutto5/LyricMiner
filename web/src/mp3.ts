import { Mp3Encoder } from '@breezystack/lamejs'

/** Encode mono PCM samples (-1..1) to an MP3 blob. */
export function encodeMp3(samples: Float32Array, sampleRate: number, kbps = 128): Blob {
  const enc = new Mp3Encoder(1, sampleRate, kbps)
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  const parts: BlobPart[] = []
  const block = 1152
  for (let i = 0; i < pcm.length; i += block) {
    const out = enc.encodeBuffer(pcm.subarray(i, i + block))
    if (out.length) parts.push(new Uint8Array(out))
  }
  const tail = enc.flush()
  if (tail.length) parts.push(new Uint8Array(tail))
  return new Blob(parts, { type: 'audio/mpeg' })
}
