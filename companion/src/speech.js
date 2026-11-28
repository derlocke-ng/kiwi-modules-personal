// Hearing and speaking, on this machine's processor (sherpa-onnx): Parakeet turns what was
// said into text; Kokoro, Pocket, Kitten, Piper or Supertonic turn its answer into a voice.
// Nothing of this leaves the machine, and it does not need the graphics card. Kokoro, Kitten
// and Piper get their sounds from piper-phonemize-node (espeak-ng, GPL-3.0-or-later).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { voiceFor, language } from './voices.js';

const require = createRequire(import.meta.url);
const sherpa = require('sherpa-onnx-node');

// the folder each part unpacks to, and how its voice engine is set up
export const MODELS = {
  hear: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
  kokoro: 'kokoro-multi-lang-v1_0',
  pocket: 'sherpa-onnx-pocket-tts-int8-2026-01-26',
  kitten: 'kitten-mini-en-v0_8',
  'piper-en': 'vits-piper-en_US-ryan-medium',
  'piper-de': 'vits-piper-de_DE-thorsten-high',
  supertonic: 'sherpa-onnx-supertonic-3-tts-int8-2026-05-11',
};
const ENGINE = {
  kokoro: (d) => ({ kokoro: { model: d('model.onnx'), voices: d('voices.bin'), tokens: d('tokens.txt') } }),
  kitten: (d) => ({ kitten: { model: d('model.onnx'), voices: d('voices.bin'), tokens: d('tokens.txt') } }),
  'piper-en': (d) => ({ vits: { model: d('en_US-ryan-medium.onnx'), tokens: d('tokens.txt') } }),
  'piper-de': (d) => ({ vits: { model: d('de_DE-thorsten-high.onnx'), tokens: d('tokens.txt') } }),
  pocket: (d) => ({ pocket: { lmFlow: d('lm_flow.int8.onnx'), lmMain: d('lm_main.int8.onnx'), encoder: d('encoder.onnx'), decoder: d('decoder.int8.onnx'),
    textConditioner: d('text_conditioner.onnx'), vocabJson: d('vocab.json'), tokenScoresJson: d('token_scores.json'), voiceEmbeddingCacheCapacity: 50 } }),
  supertonic: (d) => ({ supertonic: { durationPredictor: d('duration_predictor.int8.onnx'), textEncoder: d('text_encoder.int8.onnx'), vectorEstimator: d('vector_estimator.int8.onnx'),
    vocoder: d('vocoder.int8.onnx'), ttsJson: d('tts.json'), unicodeIndexer: d('unicode_indexer.bin'), voiceStyle: d('voice.bin') } }),
};
const PHONEMES = new Set(['kokoro', 'kitten', 'piper-en', 'piper-de']);

export class Speech {
  constructor({ dir, threads = 4 }) { Object.assign(this, { dir, threads, tts: {}, refs: {}, resamplers: {} }); }

  has(model) { return fs.existsSync(path.join(this.dir, MODELS[model])); }

  async init() {                                        // hearing now; each voice when first used
    const p = path.join(this.dir, MODELS.hear);
    // hot words (technical terms, names) need the model's word pieces as a vocabulary file
    const vocab = path.join(p, 'bpe.vocab');
    if (!fs.existsSync(vocab)) fs.writeFileSync(vocab, fs.readFileSync(path.join(p, 'tokens.txt'), 'utf8').split('\n').filter((l) => l.trim())
      .map((l) => `${l.split(' ')[0]}\t-1.0`).join('\n') + '\n');
    this.rec ||= await sherpa.OfflineRecognizer.createAsync({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: { transducer: { encoder: path.join(p, 'encoder.int8.onnx'), decoder: path.join(p, 'decoder.int8.onnx'), joiner: path.join(p, 'joiner.int8.onnx') },
        tokens: path.join(p, 'tokens.txt'), numThreads: this.threads, provider: 'cpu', debug: 0, modelType: 'nemo_transducer', modelingUnit: 'bpe', bpeVocab: vocab },
      decodingMethod: 'modified_beam_search', maxActivePaths: 4, hotwordsScore: 2.0,
    });
    return this;
  }

  // what was said: samples as Float32Array, one channel, at `sampleRate`; hot words are heard more readily
  async hear(samples, sampleRate, hotwords = []) {
    const st = hotwords.length ? this.rec.createStream(hotwords.join('/')) : this.rec.createStream();
    st.acceptWaveform({ sampleRate, samples });
    await this.rec.decodeAsync(st);
    return String(this.rec.getResult(st).text || '').trim();
  }

  async engine(name) {
    const d = (f) => path.join(this.dir, MODELS[name], f);
    return (this.tts[name] ||= await sherpa.OfflineTts.createAsync({ model: { ...ENGINE[name](d), numThreads: this.threads, provider: 'cpu', debug: false }, maxNumSentences: 1 }));
  }

  // one sentence as sound: {samples: Float32Array at 48 kHz, one channel, seconds}
  async speak(text, voiceId, languages = ['en'], germanId = '') {
    const lang = language(text, languages[0] || 'en');
    const v = voiceFor(voiceId, lang, germanId);
    const tts = await this.engine(v.engine);
    const say = clean(text);
    let cfg;
    if (v.engine === 'supertonic') cfg = { sid: v.sid, speed: 1.0, numSteps: 12, extra: { lang } };
    else if (v.engine === 'pocket') {
      const file = v.refFile ? path.join(this.dir, 'voice-refs', v.refFile) : path.join(this.dir, MODELS.pocket, 'test_wavs', v.ref + '.wav');
      const ref = (this.refs[v.id] ||= sherpa.readWave(file));
      cfg = { speed: 1.0, referenceAudio: ref.samples, referenceSampleRate: ref.sampleRate, numSteps: 5, extra: { max_reference_audio_len: 10, seed: 42 } };
    } else cfg = { sid: v.sid, speed: 1.0, silenceScale: 0.2 };
    if (PHONEMES.has(v.engine)) {
      this.phon ||= require('piper-phonemize-node');
      cfg.phonemeCodepoints = this.phon.phonemize(say, tts.lang || v.lang).filter((s) => s.length > 0);
      if (!cfg.phonemeCodepoints.length) return { samples: new Float32Array(0), seconds: 0, voice: v.id, lang };
    }
    const audio = await tts.generateAsync({ text: cfg.phonemeCodepoints ? '' : say, enableExternalBuffer: false, generationConfig: new sherpa.GenerationConfig(cfg) });
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

// Float32 mono -> a WAV file in memory (16-bit), to send as a sound file
export function wav(samples, rate = 48000) {
  const data = Buffer.allocUnsafe(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.max(-1, Math.min(1, samples[i])) * 32767 | 0, i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
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
