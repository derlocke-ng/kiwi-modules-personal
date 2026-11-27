// A brain behind an OpenAI-compatible API: Unsloth Studio at home, or any other such service.
// Studio extras: it answers with whatever model is loaded, and it has none loaded after a
// start. This brain may load its model then; it never replaces a model that is loaded.

export class OpenAIBrain {
  constructor({ name, label, url, key, model = '', local = false, studio = null }) {
    Object.assign(this, { name, label, url, key, model, local, studio });
  }

  headers() { return { Authorization: 'Bearer ' + this.key, 'Content-Type': 'application/json' }; }

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
    if (!this.url || !this.key) return { ok: false, why: 'not set up' };
    if (!this.studio) return { ok: true };
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

  // The answer in pieces. messages: [{role: 'user'|'assistant', content}].
  async *stream({ system, messages, maxTokens = 500, signal }) {
    const body = {
      model: this.model || 'default', stream: true, max_tokens: maxTokens, temperature: 0.7,
      messages: [{ role: 'system', content: system }, ...messages],
    };
    if (this.studio) Object.assign(body, { top_k: this.studio.topK, enable_thinking: false });
    const r = await fetch(this.url + '/v1/chat/completions', { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal });
    if (!r.ok) throw new Error(`${this.label} says ${r.status}: ${(await r.text()).slice(0, 200)}`);
    let buf = '';
    const dec = new TextDecoder();
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:') || line === 'data: [DONE]') continue;
        let d; try { d = JSON.parse(line.slice(5)); } catch { continue; }
        const piece = d.choices?.[0]?.delta?.content;
        if (piece) yield piece;
      }
    }
  }
}
