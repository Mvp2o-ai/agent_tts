export type PcmEncoding = "int16" | "float32";

export function float32ToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    out[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
  }
  return out;
}

export function downmixToMono(samples: Int16Array, channels: number): Int16Array {
  if (channels <= 1) return samples;
  const frames = Math.floor(samples.length / channels);
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += samples[i * channels + c]!;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(sum / channels)));
  }
  return out;
}

/** Linear resample of PCM16 mono. No-op when rates match. */
export function resamplePcm16Mono(
  input: Int16Array,
  fromRate: number,
  toRate: number,
): Int16Array {
  if (input.length === 0) return input;
  if (!Number.isFinite(fromRate) || !Number.isFinite(toRate)) return input;
  if (fromRate <= 0 || toRate <= 0 || fromRate === toRate) return input;
  const outLen = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Int16Array(outLen);
  const ratio = fromRate / toRate;
  const last = input.length - 1;
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.min(last, Math.floor(src));
    const i1 = Math.min(last, i0 + 1);
    const frac = src - i0;
    const s = input[i0]! * (1 - frac) + input[i1]! * frac;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(s)));
  }
  return out;
}

/** Drop a trailing odd byte so the frame is exact s16le sample pairs. */
export function pcm16ExactBytes(buf: ArrayBuffer): ArrayBuffer {
  if (buf.byteLength % 2 === 0) return buf;
  return buf.slice(0, buf.byteLength - 1);
}

export function toGatewayPcm16kMono(opts: {
  data: ArrayBuffer;
  encoding: PcmEncoding;
  sampleRate: number;
  channels: number;
  targetRate?: number;
}): ArrayBuffer {
  const targetRate = opts.targetRate ?? 16000;
  const channels = Math.max(1, Math.floor(opts.channels) || 1);
  const int16 =
    opts.encoding === "float32"
      ? float32ToInt16(new Float32Array(opts.data))
      : new Int16Array(opts.data.slice(0));
  const mono = downmixToMono(int16, channels);
  const resampled = resamplePcm16Mono(mono, opts.sampleRate, targetRate);
  const out = new ArrayBuffer(resampled.byteLength);
  new Uint8Array(out).set(
    new Uint8Array(resampled.buffer, resampled.byteOffset, resampled.byteLength),
  );
  return out;
}
