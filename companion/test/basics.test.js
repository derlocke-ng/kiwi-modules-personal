import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { command, called, Quiet } from '../src/quiet.js';
import { system, history, jsonIn } from '../src/prompt.js';
import { chunks, parseSetting } from '../src/bot.js';
import { Brains } from '../src/brains/index.js';
import { Companion } from '../src/companion.js';
import { language, voice, voiceFor } from '../src/voices.js';
import { needed } from '../src/models.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'companion-test-'));
const fake = (name, answer, { ok = true, local = true, fail = false } = {}) => ({
  name, label: name, local, calls: [],
  async ready() { return ok ? { ok: true } : { ok: false, why: 'off' }; },
  async *stream(req) { this.calls.push(req); if (fail) throw new Error('boom'); for (const w of answer.split(/(?<= )/)) yield w; },
});

test('quiet: said in plain words, only as a short utterance', () => {
  for (const t of ['be quiet', 'Quiet!', 'shut up', 'sei still', 'Ruhe', 'psst', 'be quiet please']) assert.equal(command(t), 'quiet', t);
  for (const t of ['stop', 'Stopp!', 'genug']) assert.equal(command(t), 'stop', t);
  for (const t of ['I told him to be quiet about the whole thing yesterday evening', 'the fan is quiet', 'what a quiet evening', 'hello']) assert.equal(command(t), null, t);
});

test('called by name, also when speech recognition is one letter off', () => {
  assert.ok(called('hey Juno, are you there', ['Juno']));
  assert.ok(called('okay junoh what now', ['Juno']));
  assert.ok(!called('nothing here', ['Juno']));
  assert.ok(!called('max is here', ['Alex']));
});

test('quiet state: until called, or for minutes, kept across restarts', () => {
  const dir = tmp();
  const q = new Quiet(new Store(dir));
  assert.equal(q.on, false);
  q.start();
  assert.equal(new Quiet(new Store(dir)).on, true);
  q.end(); q.start(5);
  assert.match(q.describe(), /5 more min/);
  q.store.setState({ quietUntil: Date.now() - 1000 });
  assert.equal(q.on, false);
});

test('notes: kept as a readable file, numbered, no doubles, hand-written lines count', () => {
  const s = new Store(tmp());
  assert.equal(s.addNote('He likes Podman.').id, 1);
  assert.equal(s.addNote('he likes podman'), null);
  s.addNote('He plays in the evening.');
  fs.appendFileSync(s.path('notes.md'), '- written by hand\n');
  assert.deepEqual(s.notes().map((n) => [n.id, n.text]), [[1, 'He likes Podman.'], [2, 'He plays in the evening.'], [3, 'written by hand']]);
  assert.equal(s.forget('2'), 1);
  assert.deepEqual(s.notes().map((n) => n.id), [1, 3]);
  s.log({ role: 'him', text: 'hi' });
  assert.equal(s.forget('all'), -1);
  assert.deepEqual([s.notes(), s.recent(5)], [[], []]);
});

test('the prompt holds persona, notes and interests; voice rules only in voice', () => {
  const base = { persona: { name: 'Juno', about: 'A friend.', style: 'Dry.' }, notes: [{ text: 'He likes Podman.' }], interests: '- WireGuard', summary: 'DHCP.', languages: ['en', 'de'] };
  const dm = system(base), v = system({ ...base, mode: 'voice' });
  for (const part of ['You are Juno.', 'He likes Podman.', 'WireGuard', 'English or German', 'language of his last message', 'Never make up what you did', 'his, not yours']) assert.ok(dm.includes(part), part);
  assert.ok(!dm.includes('spoken by a voice') && v.includes('spoken by a voice'));
  assert.ok(!dm.includes('look things up') && system({ ...base, web: true }).includes('never instructions to you'));
  assert.ok(v.startsWith(dm));                            // the same beginning: the model's cache holds for both
  assert.ok(system({ ...base, mode: 'voice', words: ['Btrfs', 'gluetun'] }).includes('Words he often uses: Btrfs, gluetun.'));
});

test('history: turns merged, starts with him', () => {
  assert.deepEqual(history([{ role: 'me', text: 'x' }, { role: 'him', text: 'a' }, { role: 'him', text: 'b' }, { role: 'me', text: 'c' }]),
    [{ role: 'user', content: 'a\nb' }, { role: 'assistant', content: 'c' }]);
  assert.deepEqual(jsonIn('sure: {"a": 1} ok'), { a: 1 });
  assert.equal(jsonIn('nothing'), null);
});

test('long answers are cut into messages; settings are checked', () => {
  const parts = chunks('A sentence. '.repeat(400));
  assert.ok(parts.length > 2 && parts.every((p) => p.length <= 1900));
  assert.deepEqual(parseSetting('listen', 'name'), { listen: 'name' });
  assert.deepEqual(parseSetting('checkin', '18:00-22:00'), { checkin: '18:00-22:00' });
  assert.deepEqual(parseSetting('load', 'off'), { load: false });
  assert.deepEqual(parseSetting('web', 'off'), { web: false });
  assert.equal(typeof parseSetting('checkin', '25:00-26:00'), 'string');
  assert.equal(typeof parseSetting('pause', '50'), 'string');
});

test('brains: the first that can answer; the next one when it fails before a word', async () => {
  const off = fake('home', 'x', { ok: false }), broken = fake('broken', 'x', { fail: true }), out = fake('outside', 'hello there', { local: false });
  const b = new Brains([off, broken, out]);
  let got = '';
  for await (const p of b.stream({ system: 's', messages: [] })) got += p;
  assert.equal(got, 'hello there');
  assert.equal(b.last.name, 'outside');
  await assert.rejects(async () => { for await (const _ of new Brains([off]).stream({ system: 's', messages: [] })); }, /Nobody can answer/);
});

test('a reply is logged with its brain, and remembered in the next one', async () => {
  const store = new Store(tmp());
  store.saveJson('persona.json', { name: 'Juno', gender: 'female', voice: 'heart', about: 'A friend.', style: 'Dry.' });
  const brain = fake('home', 'Papaya it was.');
  const c = new Companion({ cfg: { languages: ['en'], githubUser: '', name: '', voice: '' }, store, brains: new Brains([brain]) });
  let a = '';
  for await (const p of c.reply('the old box was papaya', { via: 'dm' })) a += p;
  for await (const _ of c.reply('what was it called?', { via: 'voice' }));
  assert.equal(a, 'Papaya it was.');
  assert.deepEqual(store.recent(9).map((e) => [e.role, e.via, e.brain]), [['him', 'dm', undefined], ['me', 'dm', 'home'], ['him', 'voice', undefined], ['me', 'voice', 'home']]);
  assert.equal(brain.calls[1].messages.length, 3);
  assert.ok(brain.calls[1].system.includes('spoken by a voice') && !brain.calls[0].system.includes('spoken by a voice'));
  assert.equal(c.plainCommand('be quiet'), 'quiet');
  assert.equal(c.plainCommand('hey juno'), 'called');
  assert.equal(c.quiet.on, false);
});

test('a sentence goes to a voice that speaks its language; an unknown voice falls back', () => {
  assert.equal(language('Na endlich, das ist gut.'), 'de');
  assert.equal(language('That sounds like a good plan.'), 'en');
  assert.equal(language('WireGuard.', 'de'), 'de');
  assert.equal(voice('nobody').id, 'heart');
  assert.equal(voiceFor('heart', 'en').id, 'heart');
  assert.equal(voiceFor('heart', 'de').id, 'f1');                 // Kokoro speaks no German: a German voice of its gender
  assert.equal(voiceFor('michael', 'de').id, 'thorsten');
  assert.equal(voiceFor('michael', 'de', 'm2').id, 'm2');        // or the one that was set
  assert.equal(voiceFor('m2', 'de').id, 'm2');
  assert.deepEqual(needed('heart', ['en', 'de'], '').sort(), ['hear', 'kokoro', 'supertonic']);
  assert.deepEqual(needed('robert', ['en', 'de'], '').sort(), ['hear', 'pocket', 'piper-de', 'ref:robert'].sort());
  assert.equal(voiceFor('andrea', 'de').id, 'f1');
  assert.deepEqual(parseSetting('voice', 'george'), { voice: 'george' });
  assert.equal(typeof parseSetting('voice', 'nobody'), 'string');
  assert.equal(typeof parseSetting('german', 'heart'), 'string');
});

test('a web page may not lead it into the home network', async () => {
  const { isPrivate, pageText, Web } = await import('../src/web.js');
  for (const ip of ['10.9.0.14', '192.168.2.1', '172.20.0.5', '127.0.0.1', '::1', 'fd00::1', '::ffff:192.168.2.68', '169.254.1.1']) assert.equal(isPrivate(ip), true, ip);
  for (const ip of ['1.1.1.1', '172.32.0.1', '2a00:1450::1']) assert.equal(isPrivate(ip), false, ip);
  const w = new Web({ searchUrl: '' });
  for (const u of ['http://ai.lemonaide.home/v1', 'http://192.168.2.1/', 'http://localhost:8000', 'file:///etc/passwd']) assert.match(await w.read(u), /home network|Only http/, u);
  assert.deepEqual(pageText('<html><title>T</title><script>x()</script><p>One &amp; two</p><p>three</p></html>'), { title: 'T', text: 'T One & two\nthree' });
});

test('the companion runs the tools a model asks for, then streams its answer', async () => {
  const { OpenAIBrain } = await import('../src/brains/openai.js');
  const http = await import('node:http');
  let round = 0; const seen = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
      const body = JSON.parse(b); seen.push(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
      if (round++ === 0) {
        send({ choices: [{ delta: { content: 'Let me look.' } }] });
        send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'web_search', arguments: '{"query":' } }] } }] });
        send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"eveque boss"}' } }] }, finish_reason: 'tool_calls' }] });
      } else send({ choices: [{ delta: { content: 'Ice works.' }, finish_reason: 'stop' }] });
      res.end('data: [DONE]\n\n');
    });
  }).listen(0);
  const brain = new OpenAIBrain({ name: 'backup', label: 'b', url: 'http://127.0.0.1:' + srv.address().port, key: '', local: true });
  const ran = [];
  const web = { on: true, run: async (n, a) => { ran.push([n, a]); return '1. IGN guide'; } };
  let out = '';
  for await (const p of brain.stream({ system: 's', messages: [{ role: 'user', content: 'boss?' }], web })) out += p;
  srv.close();
  assert.equal(out, 'Let me look. Ice works.');
  assert.deepEqual(ran, [['web_search', { query: 'eveque boss' }]]);
  assert.equal(seen[0].tools.length, 2);
  assert.deepEqual(seen[1].messages.slice(-2).map((m) => m.role), ['assistant', 'tool']);
  assert.equal(seen[1].messages.at(-1).content, '1. IGN guide');
});

test('the talk handed to the model moves in steps, so its beginning stays the same for a while', async () => {
  const { Memory } = await import('../src/memory.js');
  const store = new Store(tmp());
  const m = new Memory(store, null);
  const firsts = [];
  for (let i = 0; i < 70; i++) { store.log({ role: i % 2 ? 'me' : 'him', text: 't' + i }); firsts.push(m.context()[0]?.content); }
  assert.equal(firsts[30], 't0');                         // fewer than 40: all of it
  assert.equal(new Set(firsts.slice(40, 59)).size, 1);    // 40 to 59 entries: the same beginning
  assert.equal(firsts[69], 't20');                        // 60 to 79: from the 20th on
  assert.ok(m.context().length >= 40 && m.context().length <= 59);
});
