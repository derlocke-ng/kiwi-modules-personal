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
  for (const part of ['You are Juno.', 'He likes Podman.', 'WireGuard', 'English or German', 'language of his last message', 'never claim to be human']) assert.ok(dm.includes(part), part);
  assert.ok(!dm.includes('spoken by a voice') && v.includes('spoken by a voice'));
  assert.ok(v.startsWith(dm));                            // the same beginning: the model's cache holds for both
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
  assert.deepEqual(parseSetting('voice', 'george'), { voice: 'george' });
  assert.equal(typeof parseSetting('voice', 'nobody'), 'string');
  assert.equal(typeof parseSetting('german', 'heart'), 'string');
});
