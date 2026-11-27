// Hearing and speaking, on this machine's processor (sherpa-onnx): Parakeet turns what was
// said into text, Supertonic turns its answer into a voice. Nothing of this leaves the
// machine, and it does not need the graphics card.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { voice as voiceOf, language } from './voices.js';

const sherpa = createRequire(import.meta.url)('sherpa-onnx-node');

export const MODELS = {
  hear: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
  speak: 'sherpa-onnx-supertonic-3-tts-int8-2026-05-11',
};

export class Speech {
  constructor({ dir, threads = 4 }) { Object.assign(this, { dir, threads, tts: null, resamplers: {} }); }

  has(model) { return fs.existsSync(path.join(this.dir, MODELS[model])); }

  async init() {                                        // hearing now; each voice when first used
    const p = path.join(this.dir, MODELS.hear);
    this.rec ||= await sherpa.OfflineRecognizer.createAsync({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: { transducer: { encoder: path.join(p, 'encoder.int8.onnx'), decoder: path.join(p, 'decoder.int8.onnx'), joiner: path.join(p, 'joiner.int8.onnx') },
        tokens: path.join(p, 'tokens.txt'), numThreads: this.threads, provider: 'cpu', debug: 0, modelType: 'nemo_transducer' },
    });
    return this;
  }

  // what was said: samples as Float32Array, one channel, at `sampleRate`
  async hear(samples, sampleRate) {
    const st = this.rec.createStream();
    st.acceptWaveform({ sampleRate, samples });
    await this.rec.decodeAsync(st);
    return String(this.rec.getResult(st).text || '').trim();
  }

  async engine() {
    const d = path.join(this.dir, MODELS.speak);
    return (this.tts ||= await sherpa.OfflineTts.createAsync({
      model: { supertonic: { durationPredictor: path.join(d, 'duration_predictor.int8.onnx'), textEncoder: path.join(d, 'text_encoder.int8.onnx'),
        vectorEstimator: path.join(d, 'vector_estimator.int8.onnx'), vocoder: path.join(d, 'vocoder.int8.onnx'),
        ttsJson: path.join(d, 'tts.json'), unicodeIndexer: path.join(d, 'unicode_indexer.bin'), voiceStyle: path.join(d, 'voice.bin') },
        numThreads: this.threads, provider: 'cpu', debug: false },
      maxNumSentences: 1 }));
  }

  // one sentence as sound: {samples: Float32Array at 48 kHz, one channel, seconds}
  async speak(text, voiceId, languages = ['en']) {
    const v = voiceOf(voiceId);
    const lang = language(text, languages[0] || 'en');
    const tts = await this.engine();
    const audio = await tts.generateAsync({ text: clean(text), enableExternalBuffer: false,
      generationConfig: new sherpa.GenerationConfig({ sid: v.sid, speed: 1.05, numSteps: 8, extra: { lang } }) });
    const r = (this.resamplers[audio.sampleRate] ||= new sherpa.LinearResampler(audio.sampleRate, 48000));
    const samples = audio.sampleRate === 48000 ? audio.samples : r.resample(audio.samples, true);
    r.reset?.();
    return { samples, seconds: samples.length / 48000, voice: v.id, lang };
  }
}

// what a voice should not try to say
export function clean(text) {
  return text.replace(/```[\s\S]*?```/g, ' code. ').replace(/https?:\/\/\S+/g, ' a link ').replace(/[*_`#>|~]+/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim();
}

// Float32 mono at 48 kHz -> what Discord plays: 16-bit, two channels
export function toPcm(samples) {
  const out = Buffer.allocUnsafe(samples.length * 4);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i])) * 32767 | 0;
    out.writeInt16LE(s, i * 4); out.writeInt16LE(s, i * 4 + 2);
  }
  return out;
}

// 16-bit two-channel sound from Discord -> Float32 mono (still 48 kHz)
export function fromPcm(buf) {
  const n = buf.length >> 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (buf.readInt16LE(i * 4) + buf.readInt16LE(i * 4 + 2)) / 65536;
  return out;
}

// Cuts a growing answer into pieces to speak: feed(piece) gives the pieces that are complete.
// The very first piece may end at a comma or dash, so the voice starts sooner; after that,
// whole sentences (they sound better in one breath).
export class Sentences {
  constructor(min = 14, firstMin = 24) { this.buf = ''; this.min = min; this.firstMin = firstMin; this.first = true; }
  feed(piece) {
    this.buf += piece;
    const out = [];
    for (;;) {
      let cut = -1;
      const m = this.buf.slice(this.min).match(/[.!?…]["')\]]?(\s+|$)|\n+/);
      if (m && !(m[1] === '' && !m[0].includes('\n'))) cut = this.min + m.index + m[0].length;     // at the very end: wait, more may follow ("3.5")
      if (this.first) {
        const c = this.buf.slice(this.firstMin).match(/[,;:]\s|\s[—–-]\s/);
        if (c && (cut < 0 || this.firstMin + c.index + c[0].length < cut)) cut = this.firstMin + c.index + c[0].length;
      }
      if (cut < 0) break;
      const s = this.buf.slice(0, cut).trim();
      this.buf = this.buf.slice(cut);
      if (s) { out.push(s); this.first = false; }
    }
    return out;
  }
  rest() { const s = this.buf.trim(); this.buf = ''; return s ? [s] : []; }
}
