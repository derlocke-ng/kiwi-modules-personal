// The voices it can speak with: Supertonic's ten, five female and five male. Each speaks
// English and German (and 29 more languages), on the processor, about five times faster than
// the speech lasts. (Kokoro sounds a little warmer in English but, without a phonemizer under
// the GPL, it skips every word its word list lacks, "that's" and "WireGuard" among them.)
export const VOICES = ['f1', 'f2', 'f3', 'f4', 'f5', 'm1', 'm2', 'm3', 'm4', 'm5'].map((id, sid) => (
  { id, sid, gender: id[0] === 'f' ? 'female' : 'male', note: `${id[0] === 'f' ? 'female' : 'male'} voice ${id[1]}` }));

export const voice = (id) => VOICES.find((v) => v.id === id) || VOICES[0];

const DE = new Set('der die das und ich nicht ist ein eine mit auf für zu den es du was wie auch noch aber oder wenn dann schon nur mal sehr wir ihr sie mir dir dich mich kein keine hab habe hast hat bin bist sind war wird kann muss soll will doch ja nein gut heute morgen gestern jetzt hier dort weil dass über unter nach bei vom zum zur'.split(' '));
const EN = new Set('the and is are you that it of to in for on with as this but or if then just very we they me my your not no yes have has had was were will can must should would do does did what how why when where there here because about'.split(' '));

// 'de' or 'en' for one sentence, by its small words
export function language(text, fallback = 'en') {
  let de = /[äöüß]/i.test(text) ? 2 : 0, en = 0;
  for (const w of text.toLowerCase().split(/[^a-zäöüß]+/)) { if (DE.has(w)) de++; if (EN.has(w)) en++; }
  return de === en ? fallback : de > en ? 'de' : 'en';
}
