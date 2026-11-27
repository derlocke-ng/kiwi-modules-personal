#!/usr/bin/env node
// The same two lines in every candidate voice, to choose one by ear.
//   node bench/voicesamples.cjs MODELS_DIR OUT_DIR
// Kokoro, Kitten and Piper get their sounds from piper-phonemize-node (espeak-ng, GPL-3.0-or-later).
const fs = require('fs');
const path = require('path');
const sherpa = require('sherpa-onnx-node');
const phon = require('piper-phonemize-node');

const [M, OUT] = [path.resolve(process.argv[2]), path.resolve(process.argv[3])];
fs.mkdirSync(OUT, {recursive: true});
const EN = "Honestly, I'd stay with WireGuard for the home network. You keep the keys, and that's the whole point. What made you look at Tailscale?";
const DE = 'Na endlich läuft das Backup. Wie lange hast du dafür gebraucht, und was war das Problem?';
const p = (...a) => path.join(M, ...a);
const base = {numThreads: 4, provider: 'cpu', debug: false};
const rows = [];

function save(name, text, tts, cfg, phonemes) {
  const t = Date.now();
  let gc = cfg;
  if (phonemes) gc = {...cfg, phonemeCodepoints: phon.phonemize(text, tts.lang || phonemes).filter((s) => s.length > 0)};
  const audio = tts.generate({text: phonemes ? '' : text, generationConfig: new sherpa.GenerationConfig(gc)});
  const s = (Date.now() - t) / 1000, dur = audio.samples.length / audio.sampleRate;
  sherpa.writeWave(path.join(OUT, name + '.wav'), {samples: audio.samples, sampleRate: audio.sampleRate});
  rows.push({name, seconds: +s.toFixed(2), speech_s: +dur.toFixed(1)});
  console.log(`${name}: ${s.toFixed(2)} s for ${dur.toFixed(1)} s of speech`);
}

const k = p('kokoro-multi-lang-v1_0');
if (fs.existsSync(k)) {
  const tts = new sherpa.OfflineTts({model: {kokoro: {model: p('kokoro-multi-lang-v1_0', 'model.onnx'), voices: path.join(k, 'voices.bin'), tokens: path.join(k, 'tokens.txt')}, ...base}, maxNumSentences: 1});
  for (const [v, sid] of [['af_heart', 3], ['af_bella', 2], ['af_nicole', 6], ['af_sky', 10], ['bf_emma', 21], ['am_michael', 16], ['am_fenrir', 14], ['am_puck', 18], ['bm_george', 26], ['bm_fable', 25]])
    save(`en-kokoro-${v}`, EN, tts, {sid, speed: 1.0, silenceScale: 0.2}, v[0] === 'b' ? 'en-gb' : 'en-us');
}
const kt = p('kitten-mini-en-v0_8');
if (fs.existsSync(kt)) {
  const tts = new sherpa.OfflineTts({model: {kitten: {model: path.join(kt, 'model.onnx'), voices: path.join(kt, 'voices.bin'), tokens: path.join(kt, 'tokens.txt')}, ...base}, maxNumSentences: 1});
  for (let sid = 0; sid < tts.numSpeakers; sid++) save(`en-kitten-${sid}`, EN, tts, {sid, speed: 1.0}, 'en-us');
}
const pk = p('sherpa-onnx-pocket-tts-int8-2026-01-26');
if (fs.existsSync(pk)) {
  const tts = new sherpa.OfflineTts({model: {pocket: {lmFlow: path.join(pk, 'lm_flow.int8.onnx'), lmMain: path.join(pk, 'lm_main.int8.onnx'), encoder: path.join(pk, 'encoder.onnx'),
    decoder: path.join(pk, 'decoder.int8.onnx'), textConditioner: path.join(pk, 'text_conditioner.onnx'), vocabJson: path.join(pk, 'vocab.json'), tokenScoresJson: path.join(pk, 'token_scores.json'),
    voiceEmbeddingCacheCapacity: 50}, ...base}, maxNumSentences: 1});
  for (const ref of ['bria', 'loona']) {
    const w = sherpa.readWave(path.join(pk, 'test_wavs', ref + '.wav'));
    save(`en-pocket-${ref}`, EN, tts, {speed: 1.0, referenceAudio: w.samples, referenceSampleRate: w.sampleRate, numSteps: 5, extra: {max_reference_audio_len: 12, seed: 42}});
  }
}
for (const [dir, file, name, text, lang] of [['vits-piper-en_US-ryan-medium', 'en_US-ryan-medium.onnx', 'en-piper-ryan', EN, 'en-us'], ['vits-piper-de_DE-thorsten-high', 'de_DE-thorsten-high.onnx', 'de-piper-thorsten', DE, 'de']]) {
  if (!fs.existsSync(p(dir))) continue;
  const tts = new sherpa.OfflineTts({model: {vits: {model: p(dir, file), tokens: p(dir, 'tokens.txt')}, ...base}, maxNumSentences: 1});
  save(name, text, tts, {sid: 0, speed: 1.0, silenceScale: 0.2}, lang);
}
const s = p('sherpa-onnx-supertonic-3-tts-int8-2026-05-11');
if (fs.existsSync(s)) {
  const tts = new sherpa.OfflineTts({model: {supertonic: {durationPredictor: path.join(s, 'duration_predictor.int8.onnx'), textEncoder: path.join(s, 'text_encoder.int8.onnx'),
    vectorEstimator: path.join(s, 'vector_estimator.int8.onnx'), vocoder: path.join(s, 'vocoder.int8.onnx'), ttsJson: path.join(s, 'tts.json'),
    unicodeIndexer: path.join(s, 'unicode_indexer.bin'), voiceStyle: path.join(s, 'voice.bin')}, ...base}, maxNumSentences: 1});
  save('en-supertonic-m2-the-one-you-heard', EN, tts, {sid: 6, speed: 1.05, numSteps: 8, extra: {lang: 'en'}});
  for (const [v, sid] of [['f1', 0], ['m2', 6]]) save(`de-supertonic-${v}`, DE, tts, {sid, speed: 1.0, numSteps: 12, extra: {lang: 'de'}});
}
fs.writeFileSync(path.join(OUT, 'samples.json'), JSON.stringify(rows, null, 1));
