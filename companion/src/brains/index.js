// Who thinks: the brains in the order of the setting, the first that can answer. The models at
// home come first by default; a brain outside the house is named in the answer's footer.
import { OpenAIBrain } from './openai.js';
import { ClaudeCodeBrain } from './claudecode.js';
import { AnthropicBrain } from './anthropic.js';

export function makeBrains(cfg) {
  const all = {
    studio: () => new OpenAIBrain({ name: 'studio', label: 'the model at home', url: cfg.studio.url, key: cfg.studio.key, local: true, studio: cfg.studio }),
    'claude-code': () => new ClaudeCodeBrain({ ...cfg.claudeCode, web: cfg.web }),
    anthropic: () => new AnthropicBrain({ ...cfg.anthropic, web: cfg.web }),
    openai: () => new OpenAIBrain({ name: 'openai', label: 'an OpenAI-compatible service', url: cfg.openai.url, key: cfg.openai.key, model: cfg.openai.model }),
    backup: () => new OpenAIBrain({ name: 'backup', label: 'the backup model at home', url: cfg.backup.url, key: cfg.backup.key, model: cfg.backup.model, local: true }),
  };
  return new Brains(cfg.brains.filter((n) => all[n]).map((n) => all[n]()));
}

export class Brains {
  constructor(list) { this.list = list; this.last = null; }

  setWeb(on) { for (const b of this.list) { if (b.studio) b.studio.web = on; else if ('web' in b) b.web = on; b.webOn = on; } }

  // {brain} or {why: [...]}: the first brain that can answer
  async pick(opts = {}) {
    const why = [];
    for (const b of this.list) {
      if (opts.only && !opts.only.includes(b.name)) continue;
      const r = await b.ready(opts);
      if (r.ok) return { brain: b, loaded: r.loaded };
      why.push(`${b.label}: ${r.why}`);
    }
    return { why };
  }

  // One answer in pieces; when a brain fails before its first word, the next one is asked.
  async *stream(req, opts = {}) {
    const tried = [];
    for (const b of this.list) {
      const r = await b.ready(opts);
      if (!r.ok) { tried.push(`${b.label}: ${r.why}`); continue; }
      let any = false;
      try {
        for await (const piece of b.stream(req)) { any = true; this.last = b; yield piece; }
        if (any) return;
        tried.push(`${b.label}: gave no answer`);
      } catch (e) {
        if (any || req.signal?.aborted) throw e;
        tried.push(`${b.label}: ${String(e.message || e).slice(0, 160)}`);
      }
    }
    throw new Error('Nobody can answer right now. ' + tried.join('; '));
  }

  // a whole answer as one string (for its own small jobs: naming itself, taking notes)
  async ask(system, user, opts = {}) {
    let out = '';
    for await (const piece of this.stream({ system, messages: [{ role: 'user', content: user }], maxTokens: opts.maxTokens || 700 }, opts)) out += piece;
    return out.trim();
  }
}
