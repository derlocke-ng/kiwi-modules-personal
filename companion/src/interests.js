// What its person is into, to have something to talk about: lines he gives it himself, and,
// when a GitHub user name is set, his public repositories and what he pushed lately (public
// data only, asked without any login, once a day).
const DAY = 24 * 3600 * 1000;

export class Interests {
  constructor(store, user) { this.store = store; this.user = user; }

  mine() { return this.store.json('interests.json', { mine: [], github: '', fetched: 0 }); }

  add(text) {
    const d = this.mine();
    const t = String(text).replace(/\s+/g, ' ').trim();
    if (t && !d.mine.includes(t)) d.mine.push(t);
    this.store.saveJson('interests.json', d);
    return d.mine;
  }

  text() {
    const d = this.mine();
    return [...d.mine.map((m) => `- ${m}`), d.github].filter(Boolean).join('\n');
  }

  async refresh(force = false) {
    const d = this.mine();
    if (!this.user || (!force && Date.now() - d.fetched < DAY)) return false;
    const get = async (path) => {
      const r = await fetch('https://api.github.com' + path, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'kiwi-companion' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error('GitHub says ' + r.status);
      return r.json();
    };
    try {
      const repos = (await get(`/users/${encodeURIComponent(this.user)}/repos?per_page=100&sort=pushed`)).filter((r) => !r.fork && !r.archived);
      const lines = repos.slice(0, 14).map((r) => `- ${r.name}${r.language ? ` (${r.language})` : ''}: ${r.description || 'no description'}; last push ${String(r.pushed_at).slice(0, 10)}`);
      const lately = [];
      for (const r of repos.slice(0, 3)) {
        const commits = await get(`/repos/${r.full_name}/commits?per_page=4`);
        for (const c of commits) lately.push(`- ${r.name}, ${String(c.commit.author.date).slice(0, 10)}: ${c.commit.message.split('\n')[0].slice(0, 110)}`);
      }
      d.github = `His public GitHub repositories (${this.user}), most recently pushed first:\n${lines.join('\n')}` + (lately.length ? `\nHis latest commits:\n${lately.join('\n')}` : '');
      d.fetched = Date.now();
      this.store.saveJson('interests.json', d);
      return true;
    } catch { return false; }
  }
}
