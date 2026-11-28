// Remembering: the last turns go to the model as they are; now and then it writes down what
// is worth keeping about its person (notes.md) and what the two talked about (summary.md).
import { jsonIn, history } from './prompt.js';

const TURNS = 40;           // log entries handed to the model with every answer, at least
const STEP = 20;            // ... and at most this many more
const EVERY = 8;            // his messages between two looks at what is worth keeping

export class Memory {
  constructor(store, brains) { this.store = store; this.brains = brains; this.busy = false; }

  // The last turns, in a window that moves in steps of STEP entries, not by one each turn: the
  // model at home keeps what it has read and reads only the new turns, as long as the beginning
  // of what it is given stays the same.
  context() {
    const all = this.store.recent(Infinity);
    if (all.length <= TURNS) return history(all);
    const start = all.length - TURNS - ((all.length - TURNS) % STEP);
    return history(all.slice(start));
  }
  summary() { return this.store.read('summary.md').trim(); }

  // after each of his messages: every few, take notes (in the background, never in his way)
  async afterTurn() {
    const n = (this.store.state.sinceNotes || 0) + 1;
    this.store.setState({ sinceNotes: n });
    if (n >= EVERY && !this.busy) await this.takeNotes();
  }

  async takeNotes() {
    this.busy = true;
    try {
      const notes = this.store.notes();
      const talk = this.store.recent(2 * EVERY + 6).filter((e) => !e.first).map((e) => `${e.role === 'me' ? 'You' : 'He'}: ${e.text}`).join('\n');
      if (!talk) return [];
      const ask = 'These are your notes about your friend:\n' + (notes.map((n) => `- ${n.text}`).join('\n') || '(none)') +
        '\n\nThis is your latest talk:\n' + talk +
        '\n\nWrite down what a good friend would remember. "add": new facts about him that will still matter in a month (what he works on, likes, dislikes, ' +
        'people and things in his life, how he wants to be treated). Only what HE said in this talk: nothing you guessed, nothing you said yourself, nothing from ' +
        'lists you were given. Each one short sentence about him, none that the notes already hold, none about a passing mood. Usually zero to two. ' +
        '"summary": two or three sentences on what you two talked about lately, to pick up from next time. ' +
        'Answer with JSON only: {"add": ["..."], "summary": "..."}';
      const got = jsonIn(await this.brains.ask('You keep notes about a friend. You answer with JSON only.', ask, { maxTokens: 500 }));
      const added = [];
      if (got) {
        for (const t of (Array.isArray(got.add) ? got.add : []).slice(0, 4)) {
          const note = typeof t === 'string' && t.length < 300 ? this.store.addNote(t) : null;
          if (note) added.push(note);
        }
        if (typeof got.summary === 'string' && got.summary.trim()) this.store.write('summary.md', got.summary.trim() + '\n');
        this.store.setState({ sinceNotes: 0 });
      }
      this.onNotes?.();
      return added;
    } catch { return []; } finally { this.busy = false; }
  }
}
