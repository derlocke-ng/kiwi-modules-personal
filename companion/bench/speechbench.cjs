#!/usr/bin/env node
// Speaking and hearing on the CPU with sherpa-onnx: how long each model takes for a sentence,
// and whether what one says comes back right from the other.
//
//   node speechbench.cjs MODELS_DIR [OUT_DIR] [--threads 2,4] [--only tts|stt]
//
// MODELS_DIR holds the unpacked model folders (bench/fetch-models.sh). OUT_DIR gets the clips
// (to listen to) and speech.jsonl.
const fs = require('fs');
const path = require('path');
const sherpa = require('sherpa-onnx-node');

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args.splice(i, 2)[1]; };
const THREADS = flag('--threads', '2,4').split(',').map(Number);
const ONLY = flag('--only', '');
const M = path.resolve(args[0] || 'models');
const OUT = path.resolve(args[1] || 'out');
fs.mkdirSync(OUT, {recursive: true});
const rows = [];
const keep = (row) => { rows.push(row); fs.appendFileSync(path.join(OUT, 'speech.jsonl'), JSON.stringify(row) + '\n'); };

const SENT = {
  en: [
    ['short', 'Ugh, DHCP again.'],
    ['plain', 'That sounds like a good plan, do you want to start with the easy part first?'],
    ['medium', 'What was it this time, leases not handing out or the wrong gateway?'],
    ['long', 'For a home network I would stay with plain WireGuard, because you already run everything yourself and you keep the keys, and Tailscale mostly buys you convenience on devices you do not control.'],
  ],
  de: [
    ['short', 'Na endlich, das ist gut.'],
    ['plain', 'Das klingt nach einem guten Plan, willst du mit dem einfachen Teil anfangen?'],
    ['medium', 'Läuft das Backup jetzt jede Nacht auf dem Master, oder startest du es noch von Hand?'],
    ['long', 'Für einen reinen Backup-Server würde ich bei ext4 bleiben, solange du die Sicherungen mit Restic machst, weil du die Snapshots von Btrfs dann gar nicht brauchst und ein Dateisystem weniger pflegen musst.'],
  ],
};

function ttsEngines() {
  const s = path.join(M, 'sherpa-onnx-supertonic-3-tts-int8-2026-05-11');
  const out = [];
  for (const [kname, k, kfile] of [['kokoro-1.0-int8', path.join(M, 'kokoro-int8-multi-lang-v1_0'), 'model.int8.onnx'],
                                   ['kokoro-1.0', path.join(M, 'kokoro-multi-lang-v1_0'), 'model.onnx']]) {
    if (!fs.existsSync(k)) continue;
    // speaker ids of Kokoro v1.0: 3 af_heart, 0 af_alloy, 2 af_bella, 16 am_michael, 12 am_fenrir, 21 bf_emma, 26 bm_george
    for (const [voice, sid] of [['af_heart', 3], ['af_bella', 2], ['am_michael', 16], ['am_fenrir', 12], ['bf_emma', 21], ['bm_george', 26]]) {
      out.push({name: kname, voice, langs: ['en'], sid, make: (n) => new sherpa.OfflineTts({
        model: {kokoro: {model: path.join(k, kfile), voices: path.join(k, 'voices.bin'), tokens: path.join(k, 'tokens.txt'),
                         dataDir: path.join(k, 'espeak-ng-data'), lexicon: path.join(k, 'lexicon-us-en.txt')},
                numThreads: n, provider: 'cpu', debug: false}, maxNumSentences: 1}),
        gen: () => ({sid, speed: 1.0, silenceScale: 0.2})});
    }
  }
  if (fs.existsSync(s)) {
    for (const sid of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      out.push({name: 'supertonic-3-int8', voice: 'sid' + sid, langs: ['en', 'de'], sid, make: (n) => new sherpa.OfflineTts({
        model: {supertonic: {durationPredictor: path.join(s, 'duration_predictor.int8.onnx'), textEncoder: path.join(s, 'text_encoder.int8.onnx'),
                             vectorEstimator: path.join(s, 'vector_estimator.int8.onnx'), vocoder: path.join(s, 'vocoder.int8.onnx'),
                             ttsJson: path.join(s, 'tts.json'), unicodeIndexer: path.join(s, 'unicode_indexer.bin'), voiceStyle: path.join(s, 'voice.bin')},
                numThreads: n, provider: 'cpu', debug: false}, maxNumSentences: 1}),
        gen: (lang) => ({sid, speed: 1.05, numSteps: 8, extra: {lang}})});
    }
  }
  return out;
}

function sttEngines() {
  const p = path.join(M, 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8');
  const c = path.join(M, 'sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8');
  const out = [];
  if (fs.existsSync(p)) {
    out.push({name: 'parakeet-tdt-0.6b-v3-int8', make: (n) => new sherpa.OfflineRecognizer({featConfig: {sampleRate: 16000, featureDim: 80},
      modelConfig: {transducer: {encoder: path.join(p, 'encoder.int8.onnx'), decoder: path.join(p, 'decoder.int8.onnx'), joiner: path.join(p, 'joiner.int8.onnx')},
                    tokens: path.join(p, 'tokens.txt'), numThreads: n, provider: 'cpu', debug: 0, modelType: 'nemo_transducer'}})});
  }
  if (fs.existsSync(c)) {
    for (const lang of ['en', 'de']) {
      out.push({name: 'canary-180m-flash-int8/' + lang, only: lang, make: (n) => new sherpa.OfflineRecognizer({featConfig: {sampleRate: 16000, featureDim: 80},
        modelConfig: {canary: {encoder: path.join(c, 'encoder.int8.onnx'), decoder: path.join(c, 'decoder.int8.onnx'), srcLang: lang, tgtLang: lang, usePnc: 1},
                      tokens: path.join(c, 'tokens.txt'), numThreads: n, provider: 'cpu', debug: 0}})});
    }
  }
  return out;
}

const norm = (t) => t.toLowerCase().replace(/[^a-z0-9äöüß ]+/g, ' ').split(/\s+/).filter(Boolean);
function wer(ref, hyp) {                     // word errors over the reference's words
  const a = norm(ref), b = norm(hyp);
  const d = Array.from({length: a.length + 1}, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return a.length ? d[a.length][b.length] / a.length : 0;
}

const med = (xs) => { const s = xs.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const clips = [];                            // {lang, kind, text, file} to hear back

if (ONLY !== 'stt') {
  for (const e of ttsEngines()) {
    for (const n of THREADS) {
      if (e.sid !== ttsEngines().find((x) => x.name === e.name).sid && n !== THREADS[0]) continue;   // other voices: once
      let tts;
      const t0 = Date.now();
      try { tts = e.make(n); } catch (err) { console.log(e.name, 'does not load:', String(err).slice(0, 200)); break; }
      const loadMs = Date.now() - t0;
      for (const lang of e.langs) {
        for (const [kind, text] of SENT[lang]) {
          const times = [];
          let audio;
          for (let i = 0; i < 3; i++) {
            const t = Date.now();
            audio = tts.generate({text, generationConfig: new sherpa.GenerationConfig(e.gen(lang))});
            times.push((Date.now() - t) / 1000);
          }
          const dur = audio.samples.length / audio.sampleRate;
          const file = path.join(OUT, `${e.name}-${e.voice}-${lang}-${kind}.wav`);
          if (n === THREADS[0]) {
            sherpa.writeWave(file, {samples: audio.samples, sampleRate: audio.sampleRate});
            clips.push({lang, kind, text, file, tts: e.name, voice: e.voice});
          }
          keep({what: 'tts', model: e.name, voice: e.voice, threads: n, lang, kind, seconds: med(times), audio_s: +dur.toFixed(2),
                rtf: +(med(times) / dur).toFixed(3), sample_rate: audio.sampleRate, load_ms: loadMs});
          console.log(`tts ${e.name} ${e.voice} ${n} threads ${lang} ${kind}: ${med(times).toFixed(2)} s for ${dur.toFixed(1)} s of speech`);
        }
      }
    }
  }
}

if (ONLY !== 'tts') {
  if (!clips.length) {                       // clips of an earlier run
    for (const f of fs.readdirSync(OUT).filter((x) => x.endsWith('.wav'))) {
      const m = f.match(/^(.*)-([a-z0-9_]+)-(en|de)-(short|plain|medium|long)\.wav$/);
      if (m) clips.push({lang: m[3], kind: m[4], text: SENT[m[3]].find((s) => s[0] === m[4])[1], file: path.join(OUT, f), tts: m[1], voice: m[2]});
    }
  }
  const tw = path.join(M, 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8', 'test_wavs');
  for (const e of sttEngines()) {
    for (const n of THREADS) {
      const t0 = Date.now();
      const rec = e.make(n);
      const loadMs = Date.now() - t0;
      const errs = {en: [], de: []}, secs = {short: [], plain: [], medium: [], long: []};
      for (const c of clips) {
        if (e.only && e.only !== c.lang) continue;
        const wave = sherpa.readWave(c.file);
        const t = Date.now();
        const st = rec.createStream();
        st.acceptWaveform({sampleRate: wave.sampleRate, samples: wave.samples});
        rec.decode(st);
        const text = rec.getResult(st).text;
        const s = (Date.now() - t) / 1000;
        const w = wer(c.text, text);
        errs[c.lang].push(w); secs[c.kind].push(s);
        keep({what: 'stt', model: e.name, threads: n, lang: c.lang, kind: c.kind, from: c.tts + '/' + c.voice, seconds: s,
              audio_s: +(wave.samples.length / wave.sampleRate).toFixed(2), wer: +w.toFixed(3), heard: text, load_ms: loadMs});
      }
      const avg = (xs) => xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length) : NaN;
      console.log(`stt ${e.name} ${n} threads: short ${med(secs.short).toFixed(2)} s, plain ${med(secs.plain).toFixed(2)} s, medium ${med(secs.medium).toFixed(2)} s, long ${med(secs.long).toFixed(2)} s; ` +
                  `word errors en ${(100 * avg(errs.en)).toFixed(1)} %, de ${(100 * avg(errs.de)).toFixed(1)} % (${clips.length} clips); loads in ${loadMs} ms`);
      for (const lang of ['en', 'de']) {       // a real recording per language, where the model brings one
        const f = path.join(tw, lang + '.wav');
        if (!fs.existsSync(f) || (e.only && e.only !== lang)) continue;
        const wave = sherpa.readWave(f);
        const t = Date.now();
        const st = rec.createStream();
        st.acceptWaveform({sampleRate: wave.sampleRate, samples: wave.samples});
        rec.decode(st);
        console.log(`   recorded ${lang}.wav (${(wave.samples.length / wave.sampleRate).toFixed(1)} s) in ${((Date.now() - t) / 1000).toFixed(2)} s: ${rec.getResult(st).text.slice(0, 110)}`);
      }
    }
  }
}
