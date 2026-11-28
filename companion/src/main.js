// kiwi-companion: a Discord companion for one person.  node src/main.js [--console]
import readline from 'node:readline';
import { load } from './config.js';
import { Store } from './store.js';
import { makeBrains } from './brains/index.js';
import { Companion } from './companion.js';

const cfg = load();
const store = new Store(cfg.dataDir);
const companion = new Companion({ cfg, store, brains: makeBrains(cfg) });
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

if (process.argv.includes('--console')) {
  // the same companion in a terminal, to try it without Discord
  const p = await companion.start({ onNotice: say });
  say(`${p.name} (${p.gender}, voice ${p.voice}): ${p.about}`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  const prompt = () => { try { rl.prompt(); } catch { /* input ended */ } };
  prompt();
  for await (const line of rl) {
    const text = line.trim();
    if (!text) { prompt(); continue; }
    if (text === '/status') console.log(await companion.status());
    else if (text === '/memory') console.log(store.read('notes.md') || '(nothing yet)');
    else if (text === '/notes') console.log(await companion.memory.takeNotes());
    else if (text === '/opener') console.log(await companion.opener());
    else {
      const cmd = companion.plainCommand(text);
      if (cmd === 'quiet') console.log('(quiet)');
      else {
        const t0 = Date.now(); let first = 0;
        for await (const piece of companion.reply(text, { via: 'console', onNotice: say })) { first ||= Date.now() - t0; process.stdout.write(piece); }
        process.stdout.write(`\n   [${companion.brains.last?.name}, first word ${first} ms, ${Date.now() - t0} ms]\n`);
      }
    }
    prompt();
  }
  process.exit(0);
}

if (!cfg.discordToken) { console.error('No Discord bot token (DISCORD_TOKEN or DISCORD_TOKEN_FILE).'); process.exit(2); }
if (!cfg.owner) { console.error('No owner (OWNER: the Discord user id or user name of the one person I answer).'); process.exit(2); }
const { startBot } = await import('./bot.js');
await startBot({ cfg, store, companion, say });
