// Quiet: said or typed, it stops talking at once and stays silent until its name is said,
// /talk is typed, or the minutes are over. Quiet also holds back messages it would write first.

const QUIET = /\b(be quiet|quiet now|quiet please|shut up|stop talking|hush|silence|not now|sei still|sei ruhig|sei leise|ruhe jetzt|ruhe bitte|halt die klappe|still jetzt|jetzt nicht)\b|^(quiet|ruhe|still|leise|psst|shh+)[.!]*$/i;
const STOP = /^(stop|stopp|halt|ok stop|okay stop|enough|genug|reicht)[.!]*$/i;

// 'quiet' (stay silent), 'stop' (only end what is being said), or null. Short utterances only:
// "I told him to be quiet about it" inside a longer sentence is talk, not a command.
export function command(text) {
  const t = String(text || '').trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  if (!t || words > 7) return null;
  if (STOP.test(t)) return 'stop';
  return QUIET.test(t) ? 'quiet' : null;
}

export class Quiet {
  constructor(store) { this.store = store; }

  get until() { return this.store.state.quietUntil || 0; }           // 0: not quiet; -1: until called; else a time

  get on() {
    const u = this.until;
    if (u === -1) return true;
    if (u && Date.now() < u) return true;
    if (u) this.store.setState({ quietUntil: 0 });
    return false;
  }

  start(minutes = 0) { this.store.setState({ quietUntil: minutes > 0 ? Date.now() + minutes * 60000 : -1 }); }
  end() { this.store.setState({ quietUntil: 0 }); }

  describe() {
    if (!this.on) return 'talking';
    return this.until === -1 ? 'quiet until you say my name or /talk' : `quiet for ${Math.ceil((this.until - Date.now()) / 60000)} more min`;
  }
}

// Was it called? Its name, or something speech recognition makes of it, as a word of the text.
export function called(text, names) {
  const words = String(text || '').toLowerCase().replace(/[^a-z0-9äöüß ]+/g, ' ').split(/\s+/).filter(Boolean);
  const near = (a, b) => {                              // one letter off counts, for names of 4 letters and more
    if (a === b) return true;
    if (b.length < 4 || Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, miss = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++miss > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return miss + (a.length - i) + (b.length - j) <= 1;
  };
  return names.filter(Boolean).some((n) => words.some((w) => near(w, n.toLowerCase())));
}
