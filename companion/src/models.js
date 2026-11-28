// The speech models: fetched once from sherpa-onnx's releases into the data folder, checked
// against their known checksums, unpacked. Nothing is fetched while they are there.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MODELS } from './speech.js';
import { voiceFor, VOICES } from './voices.js';

const BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/';
export const FILES = {
  hear: { url: 'asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2', sha256: '1495e91b59d7fc53ddca91f3431758ec99f8fa253fdb0e1e851be0f72b14b0f9', mb: 465 },
  kokoro: { url: 'tts-models/kokoro-multi-lang-v1_0.tar.bz2', sha256: '60703707bc05ccd48d60e1eb723f38b07d6e474795a0b6a588d7220400e0f7a4', mb: 334 },
  pocket: { url: 'tts-models/sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2', sha256: 'f4da7c7bd465f7b91e89191487fe90504396a51d6f0bcf94d0787633e2657293', mb: 94 },
  kitten: { url: 'tts-models/kitten-mini-en-v0_8.tar.bz2', sha256: '518f9b130320f690d5b5476df77bde4215fca67773cda16710318e5081234b9d', mb: 64 },
  'piper-en': { url: 'tts-models/vits-piper-en_US-ryan-medium.tar.bz2', sha256: 'c546af78b6395b4e7c4ce1ed899438b64426a362f5d4ec5fecd090ded9ad7505', mb: 64 },
  'piper-de': { url: 'tts-models/vits-piper-de_DE-thorsten-high.tar.bz2', sha256: 'dd4ed1b0d42c30a1a4862fc2b243e8044d52b8889c9ff3d1e99e92028888bc4a', mb: 110 },
  supertonic: { url: 'tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2', sha256: '82fa96f91c4ef8abaae3a14a3f4153facf88bed821d1f7331cec2700f432c427', mb: 123 },
};

// what a voice needs: hearing, its own engine, the engine of the voice that speaks its other
// language, and the recording a cloned voice copies
export function needed(voiceId, languages, germanId) {
  const out = new Set(['hear']);
  for (const lang of languages) {
    const v = voiceFor(voiceId, lang, germanId);
    out.add(v.engine);
    if (v.refFile) out.add('ref:' + v.id);
  }
  return [...out];
}

const REFS = 'https://huggingface.co/kyutai/tts-voices/resolve/main/voice-donations/';

async function fetchChecked(url, sha256, dest) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`${url.split('/').pop()} could not be fetched (${r.status})`);
  const hash = crypto.createHash('sha256');
  const tmp = dest + '.part';
  const out = fs.createWriteStream(tmp);
  for await (const chunk of r.body) { hash.update(chunk); if (!out.write(chunk)) await new Promise((res) => out.once('drain', res)); }
  await new Promise((res) => out.end(res));
  if (hash.digest('hex') !== sha256) { fs.rmSync(tmp, { force: true }); throw new Error(`${url.split('/').pop()} is not the file I know (checksum): not used`); }
  fs.renameSync(tmp, dest);
}

export async function ensure(dir, names, say = () => {}) {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of names) {
    if (name.startsWith('ref:')) {                      // the recording a cloned voice copies
      const v = VOICES.find((x) => x.id === name.slice(4));
      const dest = path.join(dir, 'voice-refs', v.refFile);
      if (fs.existsSync(dest)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      say(`fetching the voice ${v.id} (1 MB), once`);
      await fetchChecked(REFS + v.refFile, v.sha256, dest);
      continue;
    }
    if (fs.existsSync(path.join(dir, MODELS[name]))) continue;
    const f = FILES[name];
    say(`fetching ${name === 'hear' ? 'what I need to hear' : 'the voice ' + name} (${f.mb} MB), once`);
    const tmp = path.join(dir, name + '.tar.bz2.part');
    const r = await fetch(BASE + f.url, { redirect: 'follow' });
    if (!r.ok) throw new Error(`the ${name} model could not be fetched (${r.status})`);
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(tmp);
    for await (const chunk of r.body) { hash.update(chunk); if (!out.write(chunk)) await new Promise((res) => out.once('drain', res)); }
    await new Promise((res) => out.end(res));
    if (hash.digest('hex') !== f.sha256) { fs.rmSync(tmp, { force: true }); throw new Error(`the ${name} model is not the file I know (checksum): not used`); }
    const code = await new Promise((res) => spawn('tar', ['xjf', tmp, '-C', dir], { stdio: 'ignore' }).on('exit', res).on('error', () => res(1)));
    fs.rmSync(tmp, { force: true });
    if (code !== 0) throw new Error(`the ${name} model could not be unpacked`);
  }
}
