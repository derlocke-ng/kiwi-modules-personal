#!/usr/bin/env node
// The whole voice chain without Discord: a clip of someone speaking -> speech to text -> the
// brain's answer -> its first sentence as sound. Says how long each step takes, counted from
// the end of the clip (the silence that ends a sentence in a call comes on top).
//
//   DATA_DIR=... AI_URL=... AI_KEY_FILE=... node bench/voicebench.mjs MODELS_DIR CLIP.wav [CLIP.wav ...] [--voice ID] [--save DIR]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { load } from '../src/config.js';
import { Store } from '../src/store.js';
import { makeBrains } from '../src/brains/index.js';
import { Companion } from '../src/companion.js';
import { Speech, Sentences } from '../src/speech.js';

const sherpa = createRequire(import.meta.url)('sherpa-onnx-node');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args.splice(i, 2)[1]; };
const voiceId = flag('--voice', ''), save = flag('--save', '');
const [models, ...clips] = args;
const cfg = load();
const companion = new Companion({ cfg, store: new Store(cfg.dataDir), brains: makeBrains(cfg) });
await companion.start();
if (voiceId) companion.persona.voice = voiceId;
const speech = await new Speech({ dir: path.resolve(models), threads: cfg.speech.threads }).init();
await speech.speak('Warm up.', companion.persona.voice, cfg.languages);          // the first use loads the voice
console.log(`${companion.persona.name}, voice ${companion.persona.voice}, ${cfg.speech.threads} threads`);
const rows = [];
for (const clip of clips) {
  const wave = sherpa.readWave(clip);
  const t0 = Date.now();
  const text = await speech.hear(wave.samples, wave.sampleRate);
  const tHeard = Date.now();
  const cut = new Sentences();
  let tWord = 0, tSentence = 0, tSound = 0, first = '', all = '', chain = Promise.resolve(), n = 0, spoken = 0;
  const speak = (s) => { chain = chain.then(async () => {
    const a = await speech.speak(s, companion.persona.voice, cfg.languages);
    tSound ||= Date.now(); spoken += a.seconds;
    if (save) sherpa.writeWave(path.join(save, `${path.basename(clip, '.wav')}-answer-${n++}.wav`), { samples: a.samples, sampleRate: 48000 });
  }); };
  for await (const piece of companion.reply(text, { via: 'voice' })) {
    tWord ||= Date.now(); all += piece;
    for (const s of cut.feed(piece)) { if (!tSentence) { tSentence = Date.now(); first = s; } speak(s); }
  }
  for (const s of cut.rest()) { if (!tSentence) { tSentence = Date.now(); first = s; } speak(s); }
  await chain;
  const row = { clip: path.basename(clip), clip_s: +(wave.samples.length / wave.sampleRate).toFixed(1), heard: text, hear_ms: tHeard - t0, first_word_ms: tWord - tHeard,
    first_sentence_ms: tSentence - tHeard, first_sound_ms: tSound - t0, all_spoken_ms: Date.now() - t0, speech_s: +spoken.toFixed(1), answer: all.trim() };
  rows.push(row);
  console.log(`${row.clip} (${row.clip_s} s): heard in ${row.hear_ms} ms "${text}"\n   first word +${row.first_word_ms} ms, first sentence +${row.first_sentence_ms} ms, FIRST SOUND ${row.first_sound_ms} ms after he stopped; answer: ${row.answer.slice(0, 160)}`);
}
const med = (k) => rows.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
console.log(`== median: hear ${med('hear_ms')} ms, first sound ${med('first_sound_ms')} ms after the end of his sentence (${rows.length} clips)`);
if (save) fs.writeFileSync(path.join(save, 'voicebench.json'), JSON.stringify(rows, null, 1));
process.exit(0);
