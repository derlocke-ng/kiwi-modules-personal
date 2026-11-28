#!/usr/bin/env node
// Test clips of someone talking to the companion, made with the voice engine itself (no
// recordings of a person are kept anywhere).  node bench/makeclips.mjs MODELS_DIR OUT_DIR
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { Speech } from '../src/speech.js';
const sherpa = createRequire(import.meta.url)('sherpa-onnx-node');
const [models, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const speech = new Speech({ dir: path.resolve(models), threads: 4 });
const CLIPS = [
  ['en-backup', 'm4', 'Hey, I finally got the backup running last night.'],
  ['en-rust', 'm4', 'What do you think, should I learn Rust or stick with Python?'],
  ['en-low', 'f3', "I don't really feel like doing anything today."],
  ['en-vpn', 'm5', 'So what would you pick for a home network, WireGuard or Tailscale?'],
  ['de-btrfs', 'm4', 'Sag mal, lohnt sich Btrfs für den Backup-Server, oder bleibe ich bei ext4?'],
  ['de-fertig', 'f3', 'Ich hab heute endlich das Backup fertig bekommen.'],
];
for (const [name, voice, text] of CLIPS) {
  const a = await speech.speak(text, voice, [name.slice(0, 2)]);
  sherpa.writeWave(path.join(out, name + '.wav'), { samples: a.samples, sampleRate: 48000 });
  fs.writeFileSync(path.join(out, name + '.txt'), text + '\n');
}
console.log(CLIPS.length, 'clips in', out);
process.exit(0);
