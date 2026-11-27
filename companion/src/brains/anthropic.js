// A brain at Anthropic, with an API key (the way Anthropic names for one's own programs).
import Anthropic from '@anthropic-ai/sdk';

export class AnthropicBrain {
  constructor({ key, model = 'claude-opus-5-5' }) {
    Object.assign(this, { name: 'anthropic', label: 'Claude (Anthropic API)', local: false, key, model });
    this.client = key ? new Anthropic({ apiKey: key }) : null;
  }

  async ready() { return this.client ? { ok: true } : { ok: false, why: 'no API key' }; }

  async *stream({ system, messages, maxTokens = 1000, signal }) {
    // The persona and notes change rarely: cached. A chat answer needs little thinking: effort low.
    // A request the model declines is answered by the fallback Anthropic chooses.
    const stream = this.client.beta.messages.stream({
      model: this.model, max_tokens: maxTokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages, output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    }, { signal });
    try {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield event.delta.text;
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') throw new Error('Claude declined to answer this');
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new Error('Anthropic does not take the API key');
      if (e instanceof Anthropic.RateLimitError) throw new Error('Anthropic says: too many requests, try later');
      if (e instanceof Anthropic.APIConnectionError) throw new Error('Anthropic is not reachable');
      if (e instanceof Anthropic.APIError) throw new Error(`Anthropic says ${e.status}: ${String(e.message).slice(0, 200)}`);
      throw e;
    }
  }
}
