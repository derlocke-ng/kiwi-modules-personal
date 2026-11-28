import { TOOLS } from '../web.js';

// A brain behind an OpenAI-compatible API: Unsloth Studio at home, a llama.cpp server, or any other such service.
// Studio extras: it answers with whatever model is loaded, and it has none loaded after a
// start. This brain may load its model then; it never replaces a model that is loaded.

export class OpenAIBrain {
  constructor({ name, label, url, key, model = '', local = false, studio = null }) {
    Object.assign(this, { name, label, url, key, model, local, studio });
  }


  headers() { return this.key ? { Authorization: 'Bearer ' + this.key, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }; }

  async call(path, body, timeoutMs = 8000) {
    const r = await fetch(this.url + path, {
      method: body === undefined ? 'GET' : 'POST', headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
    return { ok: r.ok, status: r.status, data };
  }

  // {ok, why, loading}: can it answer now? Studio without a model: load it, if that is allowed.
  async ready({ onNotice } = {}) {
    if (!this.url || (!this.key && !this.local)) return { ok: false, why: 'not set up' };
    if (!this.studio) {
      if (!this.local) return { ok: true };
      try {                                             // a machine at home may be off: ask briefly, not for minutes
        const r = await this.call('/v1/models', undefined, 4000);
        return r.ok ? { ok: true } : { ok: false, why: 'says ' + r.status };
      } catch { return { ok: false, why: 'does not answer (is the machine on?)' }; }
    }
    let st;
    try { st = await this.call('/v1/status', undefined, 4000); } catch (e) { return { ok: false, why: 'does not answer (is the machine on?)' }; }
    if (!st.ok) return { ok: false, why: 'says ' + st.status };
    const s = st.data;
    if (s.is_audio || s.is_diffusion) return { ok: false, why: 'has another kind of model loaded (not a chat model)' };
    if (s.context_length) return { ok: true };
    if (!this.studio.mayLoad || !this.studio.model) return { ok: false, why: 'has no model loaded, and I may not load one' };
    if (this.loading) return this.loading;
    onNotice?.('The model at home is not loaded. Loading it, about a minute.');
    this.loading = this.load().finally(() => { this.loading = null; });
    return this.loading;
  }

  async load() {
    const body = { model_path: this.studio.model, max_seq_length: this.studio.context, cache_type_kv: 'q8_0', disable_vision: true, cache_ram: 16384 };
    if (this.studio.quant) body.gguf_variant = this.studio.quant;
    try {
      const r = await this.call('/v1/load', body, 15 * 60 * 1000);
      return r.ok ? { ok: true, loaded: true } : { ok: false, why: 'could not load its model (' + r.status + ')' };
    } catch (e) { return { ok: false, why: 'did not finish loading its model' }; }
  }

  // The answer in pieces. messages: [{role: 'user'|'assistant', content}]. With `web` (the
  // companion's own search, web.js) it offers the model two tools and runs them itself, a few
  // rounds at most; without it, Studio's own web search when that is switched on.
  async *stream({ system, messages, maxTokens = 500, signal, web, onTool }) {
    const msgs = [{ role: 'system', content: system }, ...messages];
    const own = web?.on && this.webOn !== false;
    for (let round = 0; round < 5; round++) {
      const body = { model: this.model || 'default', stream: true, max_tokens: maxTokens, temperature: 0.7, messages: msgs };
      if (this.studio) Object.assign(body, { top_k: this.studio.topK, enable_thinking: false });
      if (own) Object.assign(body, { tools: TOOLS, tool_choice: round < 4 ? 'auto' : 'none' });
      const builtin = !own && this.studio && this.studio.web && !this.noWeb;
      if (builtin) Object.assign(body, { enable_tools: true, enabled_tools: ['web_search'], permission_mode: 'off', confirm_tool_calls: false,
        max_tool_calls_per_message: 4, tool_call_timeout: 30, nudge_tool_calls: true });
      let r = await fetch(this.url + '/v1/chat/completions', { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal });
      if (!r.ok && builtin && r.status === 400) {        // Studio started without its tools: answer without the web
        this.noWeb = true;
        for (const k of ['enable_tools', 'enabled_tools', 'permission_mode', 'confirm_tool_calls', 'max_tool_calls_per_message', 'tool_call_timeout', 'nudge_tool_calls']) delete body[k];
        r = await fetch(this.url + '/v1/chat/completions', { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal });
      }
      if (!r.ok) throw new Error(`${this.label} says ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const calls = [];
      let said = '';
      if (round === 0) this.lastChar = '';
      for await (const d of events(r.body)) {
        const c = d.choices?.[0];
        if (!c) continue;
        let piece = c.delta?.content;
        if (piece) {
          if (/[.!?:]$/.test(this.lastChar || '') && /^[\p{Lu}"„(]/u.test(piece)) piece = ' ' + piece;   // text before and after a search, glued
          this.lastChar = piece.slice(-1);
          said += piece;
          yield piece;
        }
        for (const t of c.delta?.tool_calls || []) {
          const k = t.index ?? calls.length;
          calls[k] ||= { id: t.id || 'call_' + k, type: 'function', function: { name: '', arguments: '' } };
          if (t.id) calls[k].id = t.id;
          if (t.function?.name) calls[k].function.name += t.function.name;
          if (t.function?.arguments) calls[k].function.arguments += t.function.arguments;
        }
      }
      if (!calls.length || !own) return;
      msgs.push({ role: 'assistant', content: said || null, tool_calls: calls });
      onTool?.(calls[0].function.name);
      for (const call of calls) {
        let args = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* the model wrote broken JSON: the tool says so */ }
        msgs.push({ role: 'tool', tool_call_id: call.id, content: await web.run(call.function.name, args) });
      }
    }
  }
}

// the data lines of a server-sent event stream, as objects
async function* events(body) {
  let buf = '';
  const dec = new TextDecoder();
  for await (const chunk of body) {
    buf += dec.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:') || line === 'data: [DONE]') continue;
      try { yield JSON.parse(line.slice(5)); } catch { /* not JSON */ }
    }
  }
}
