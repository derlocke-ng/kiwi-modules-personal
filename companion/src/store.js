// What the companion keeps, as plain files in one folder: who it is, what it knows about its
// person (notes.md, readable and editable), the talk so far (chat.jsonl), and its switches.
import fs from 'node:fs';
import path from 'node:path';

const NOTES_HEAD = '# What I know about you\n\n<!-- One fact per line. Edit freely. /memory shows them, /forget N removes one. -->\n\n';

export class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  path(name) { return path.join(this.dir, name); }

  read(name, dflt = '') {
    try { return fs.readFileSync(this.path(name), 'utf8'); } catch { return dflt; }
  }

  write(name, text) {                                   // whole or not at all
    const tmp = this.path(name + '.tmp');
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, this.path(name));
  }

  json(name, dflt = {}) {
    try { return JSON.parse(this.read(name, '')); } catch { return structuredClone(dflt); }
  }

  saveJson(name, obj) { this.write(name, JSON.stringify(obj, null, 1) + '\n'); }

  // its switches (quiet, off, settings changed by command)
  get state() { return this._state ??= this.json('state.json', {}); }
  setState(changes) { Object.assign(this.state, changes); this.saveJson('state.json', this.state); }

  // notes: "- [7] 2026-11-27 text"
  notes() {
    const out = [];
    for (const line of this.read('notes.md').split('\n')) {
      const m = line.match(/^- \[(\d+)\]\s+(\d{4}-\d{2}-\d{2})?\s*(.+)$/);
      if (m) out.push({ id: Number(m[1]), date: m[2] || '', text: m[3].trim() });
      else if (/^- \S/.test(line)) out.push({ id: 0, date: '', text: line.slice(2).trim() });   // a line he wrote by hand
    }
    let next = Math.max(0, ...out.map((n) => n.id)) + 1;
    for (const n of out) if (!n.id) n.id = next++;
    return out;
  }

  saveNotes(notes) {
    this.write('notes.md', NOTES_HEAD + notes.map((n) => `- [${n.id}] ${n.date || today()} ${n.text}`).join('\n') + (notes.length ? '\n' : ''));
  }

  addNote(text) {
    const notes = this.notes();
    const clean = String(text).replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    const key = (s) => s.toLowerCase().replace(/[^a-z0-9äöüß ]/g, '');
    if (notes.some((n) => key(n.text) === key(clean))) return null;
    const note = { id: Math.max(0, ...notes.map((n) => n.id)) + 1, date: today(), text: clean };
    this.saveNotes([...notes, note]);
    return note;
  }

  forget(what) {                                        // a number, or "all": the notes, the talk, the summary
    if (what === 'all') {
      for (const f of ['notes.md', 'chat.jsonl', 'summary.md']) fs.rmSync(this.path(f), { force: true });
      return -1;
    }
    const notes = this.notes();
    const rest = notes.filter((n) => n.id !== Number(what));
    if (rest.length !== notes.length) this.saveNotes(rest);
    return notes.length - rest.length;
  }

  log(entry) {                                          // {role, text, via, brain}
    fs.appendFileSync(this.path('chat.jsonl'), JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 });
  }

  recent(n) {
    const lines = this.read('chat.jsonl').trimEnd().split('\n').filter(Boolean).slice(-n);
    return lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }
}

export const today = () => new Date().toLocaleDateString('sv');      // 2026-11-27, local time
