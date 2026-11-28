import test from 'node:test';
import assert from 'node:assert/strict';
import { Sentences, clean, toPcm, fromPcm } from '../src/speech.js';
import { finished } from '../src/voice.js';

test('an answer is cut into pieces to speak; the first piece early', () => {
  const c = new Sentences();
  const out = [];
  for (const p of ['Right, WireGuard is the one then, tha', "t's the call I'd make too. You hold the ke", 'ys. Version 3.5 is out', '. Fine.']) out.push(...c.feed(p));
  out.push(...c.rest());
  assert.deepEqual(out, ['Right, WireGuard is the one then,', "that's the call I'd make too.", 'You hold the keys.', 'Version 3.5 is out.', 'Fine.']);
});

test('what a voice should not say is taken out; sound converts both ways', () => {
  assert.equal(clean('**Hi** `x`, see https://a.b/c 😀 ok'), 'Hi x, see a link ok');
  const pcm = toPcm(Float32Array.from([0, 0.5, -0.5, 1]));
  assert.equal(pcm.length, 16);
  const back = fromPcm(pcm);
  assert.ok(Math.abs(back[1] - 0.5) < 0.001 && Math.abs(back[2] + 0.5) < 0.001);
});

test('a sentence that sounds unfinished gets more time before the answer', () => {
  for (const t of ['I finally got the backup running.', 'What do you think?', 'Na endlich!']) assert.equal(finished(t), true, t);
  for (const t of ['So I was thinking that', 'I tried it and.', 'Well, um.', 'The backup is running but', 'Ich hab das Backup fertig und']) assert.equal(finished(t), false, t);
});
