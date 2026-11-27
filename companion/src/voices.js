// The voices it can speak with, and which model each needs (speech.js loads them, models.js
// fetches them). Kokoro, Pocket and Kitten speak English only: such a voice hands German
// sentences to the German voice named in the settings, or to the one below that fits its gender.
const kokoro = (id, sid, gender, note, lang = 'en-us') => ({ id, engine: 'kokoro', sid, gender, note, lang, langs: ['en'] });

export const VOICES = [
  kokoro('heart', 3, 'female', 'American, warm'), kokoro('bella', 2, 'female', 'American, lively'), kokoro('nicole', 6, 'female', 'American, soft'),
  kokoro('sky', 10, 'female', 'American, light'), kokoro('emma', 21, 'female', 'British, calm', 'en-gb'),
  kokoro('michael', 16, 'male', 'American, relaxed'), kokoro('fenrir', 14, 'male', 'American, deep'), kokoro('puck', 18, 'male', 'American, bright'),
  kokoro('george', 26, 'male', 'British, dry', 'en-gb'), kokoro('fable', 25, 'male', 'British, storyteller', 'en-gb'),
  { id: 'bria', engine: 'pocket', ref: 'bria', gender: 'female', note: 'American, natural', langs: ['en'] },
  { id: 'loona', engine: 'pocket', ref: 'loona', gender: 'female', note: 'American, bright', langs: ['en'] },
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((sid) => ({ id: 'kitten' + (sid + 1), engine: 'kitten', sid, gender: sid % 2 ? 'female' : 'male', note: 'expressive', lang: 'en-us', langs: ['en'] })),
  { id: 'ryan', engine: 'piper-en', sid: 0, gender: 'male', note: 'American, plain, very quick', lang: 'en-us', langs: ['en'] },
  { id: 'thorsten', engine: 'piper-de', sid: 0, gender: 'male', note: 'German', lang: 'de', langs: ['de'] },
  ...['f1', 'f2', 'f3', 'f4', 'f5', 'm1', 'm2', 'm3', 'm4', 'm5'].map((id, sid) => (
    { id, engine: 'supertonic', sid, gender: id[0] === 'f' ? 'female' : 'male', note: 'English and German', langs: ['en', 'de'] })),
];

export const voice = (id) => VOICES.find((v) => v.id === id) || VOICES[0];

// the voice that speaks a sentence in `lang`: the chosen one if it can, else the German one
export function voiceFor(id, lang, germanId = '') {
  const v = voice(id);
  if (v.langs.includes(lang)) return v;
  if (lang === 'de') {
    const g = VOICES.find((x) => x.id === germanId && x.langs.includes('de'));
    return g || (v.gender === 'female' ? voice('f1') : voice('thorsten'));
  }
  return voice('heart');
}

const DE = new Set('der die das und ich nicht ist ein eine mit auf für zu den es du was wie auch noch aber oder wenn dann schon nur mal sehr wir ihr sie mir dir dich mich kein keine hab habe hast hat bin bist sind war wird kann muss soll will doch ja nein gut heute morgen gestern jetzt hier dort weil dass über unter nach bei vom zum zur'.split(' '));
const EN = new Set('the and is are you that it of to in for on with as this but or if then just very we they me my your not no yes have has had was were will can must should would do does did what how why when where there here because about'.split(' '));

// 'de' or 'en' for one sentence, by its small words
export function language(text, fallback = 'en') {
  let de = /[äöüß]/i.test(text) ? 2 : 0, en = 0;
  for (const w of text.toLowerCase().split(/[^a-zäöüß]+/)) { if (DE.has(w)) de++; if (EN.has(w)) en++; }
  return de === en ? fallback : de > en ? 'de' : 'en';
}
