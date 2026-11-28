#!/usr/bin/env node
// The same small talk through each brain, to compare how it sounds.
//   DATA_DIR=... (a throwaway folder) BRAINS=studio node bench/convo.mjs ["think"]
import fs from 'node:fs';
import { load } from '../src/config.js';
import { Store } from '../src/store.js';
import { makeBrains } from '../src/brains/index.js';
import { Companion } from '../src/companion.js';
const TURNS = ["oi, what's up?", 'what are you tinkering?', "what are YOU doing there? that's my project lol",
  "I'm kinda tired today, didn't get much done", 'any idea what I should do tonight?'];
const cfg = load();
fs.rmSync(cfg.dataDir + '/chat.jsonl', { force: true });
const c = new Companion({ cfg, store: new Store(cfg.dataDir), brains: makeBrains(cfg) });
await c.start();
if (process.argv[2] === 'think') for (const b of c.brains.list) if (b.studio) b.think = true;
for (const t of TURNS) {
  let out = '', t0 = Date.now(), first = 0;
  for await (const p of c.reply(t, { via: 'dm' })) { first ||= Date.now() - t0; out += p; }
  console.log(`> ${t}\n  ${out.trim().replace(/\n+/g, ' / ')}   [${c.brains.last?.name}, ${first} ms]`);
}
process.exit(0);
