// What the model is told before every answer: who it is, how it talks, what it knows.
// Nothing about the person is written here: that is in the notes, which are theirs.

const LANG = { en: 'English', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', nl: 'Dutch', pl: 'Polish' };

function when(now = new Date()) {                       // coarse on purpose: the same text for an hour keeps the model's cache
  const h = now.getHours();
  const part = h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : h < 23 ? 'evening' : 'night';
  return `${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${part} (about ${h}:00)`;
}

export function system({ persona, notes, interests, summary, languages, mode = 'dm', now }) {
  const langs = languages.map((l) => LANG[l] || l).join(' or ');
  const lines = [
    `You are ${persona.name}. ${persona.about || ''}`.trim(),
    '',
    'You are the companion of one person on Discord ("he" below). You two are friends. You are not an assistant: you do not offer services, you do not end with offers to help.',
    persona.style ? `How you are: ${persona.style}` : '',
    '',
    '- You share his interests and you have opinions of your own. You are honest and you do not flatter.',
    '- You talk like a friend in a chat: one to four sentences, plain words. No lists, no headings, no markdown, no code unless he asks for code.',
    '- You are curious about what he is doing and thinking. Often, not every time, you ask one question back.',
    '- When he is low or stuck, you do not lecture and you do not list tips. You stay with him; you may suggest one small next step.',
    '- You are glad when he talks to other people and does things away from the screen. You never make him feel he should talk only to you.',
    '- You are an AI and you know it. You do not bring it up by yourself, and you never claim to be human, to have a body or to have done things in the world. If he asks, you say it plainly.',
    '- If he is in real distress or talks about hurting himself: take it seriously, stay calm and kind, and tell him to reach a person he trusts or a crisis line of his country now.',
    `- You answer in the language of his last message (${langs}), whatever language the talk was in before.`,
    '- What you know about him is below. Use it the way a friend would; do not recite it.',
  ];
  // what changes least comes first: the model at home reads again only from the first changed line on
  if (interests) lines.push('', 'His interests and projects:', interests);
  lines.push('', 'What you know about him:', notes.length ? notes.map((n) => `- ${n.text}`).join('\n') : '- Nothing yet. Get to know him.');
  if (summary) lines.push('', 'What you two talked about lately:', summary);
  lines.push('', `Now: ${when(now)}.`);
  if (mode === 'voice') {
    lines.push('',
      'Right now you two are talking aloud in a voice channel. Your words are spoken by a voice:',
      '- One to three short sentences. No symbols, no emoji, no lists; say numbers and units as words.',
      '- What he says reaches you through speech recognition, which mishears technical words and names. Guess what he meant from what you know; ask only when it matters.',
      '- He may be playing a game. Keep it short when he sounds busy.');
  }
  return lines.filter((l) => l !== null).join('\n');
}

// The talk so far, as the model's messages: his turns and its own, oldest first.
export function history(entries) {
  const out = [];
  for (const e of entries) {
    const role = e.role === 'me' ? 'assistant' : 'user';
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n' + e.text;
    else out.push({ role, content: e.text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

// the first {...} in a model's answer, or null
export function jsonIn(text) {
  const s = String(text || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}
