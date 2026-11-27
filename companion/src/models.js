// The speech models: fetched once from sherpa-onnx's releases into the data folder, checked
// against their known checksums, unpacked. Nothing is fetched while they are there.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MODELS } from './speech.js';

const BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/';
export const FILES = {
  hear: { url: 'asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2', sha256: '1495e91b59d7fc53ddca91f3431758ec99f8fa253fdb0e1e851be0f72b14b0f9', mb: 465 },
  speak: { url: 'tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2', sha256: '82fa96f91c4ef8abaae3a14a3f4153facf88bed821d1f7331cec2700f432c427', mb: 123 },
};

export async function ensure(dir, names, say = () => {}) {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of names) {
    if (fs.existsSync(path.join(dir, MODELS[name]))) continue;
    const f = FILES[name];
    say(`fetching what I need to ${name} (${f.mb} MB), once`);
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
