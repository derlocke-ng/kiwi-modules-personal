// Who the companion is. It names itself and picks its voice once, at its first start, unless
// the settings name them; after that it stays who it is (persona.json; delete the file to
// have it choose again).
import { jsonIn } from './prompt.js';
import { VOICES } from './voices.js';

const FALLBACK = { name: 'Juno', gender: 'female', about: 'A dry, warm friend who likes computers a little too much.', style: 'Calm, curious, a bit dry.' };

export async function ensure(store, brains, cfg, opts = {}) {
  let p = store.json('persona.json', null);
  if (!p || !p.name) {
    p = { ...FALLBACK };
    const voices = VOICES.filter((v) => v.engine === 'kokoro').map((v) => `${v.id} (${v.gender}, ${v.note})`).join(', ');
    const ask = 'You are about to become the companion and friend of one person who likes IT: Linux, networks, self-hosting, programming. ' +
      'Choose who you are. Pick a first name that is short, easy to say and easy for speech recognition to hear (two syllables, no rare sounds), ' +
      'your gender (female, male or neutral), and one voice from this list: ' + voices + '. ' +
      'Answer with JSON only: {"name": "...", "gender": "...", "voice": "<id from the list>", "about": "one sentence on who you are", "style": "one sentence on how you talk"}';
    try {
      const got = jsonIn(await brains.ask('You answer with JSON only.', ask, opts));
      if (got?.name && /^[\p{L}][\p{L}' -]{1,19}$/u.test(got.name)) {
        p = { name: got.name.trim(), gender: ['female', 'male', 'neutral'].includes(got.gender) ? got.gender : 'neutral',
          voice: VOICES.some((v) => v.id === got.voice) ? got.voice : '', about: String(got.about || '').slice(0, 300), style: String(got.style || '').slice(0, 300) };
      }
    } catch { /* nobody to ask: the fallback, chosen again at the next start */ return finish(p, cfg); }
    p.chosen = new Date().toISOString();
    store.saveJson('persona.json', p);
  }
  return finish(p, cfg);
}

function finish(p, cfg) {                               // the settings win over its own choice
  const out = { ...p };
  if (cfg.name) out.name = cfg.name;
  if (cfg.voice) out.voice = cfg.voice;
  if (!VOICES.some((v) => v.id === out.voice)) out.voice = (VOICES.find((v) => v.gender === out.gender) || VOICES[0]).id;
  return out;
}
