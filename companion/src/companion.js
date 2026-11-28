// The companion itself, without Discord: it takes what its person said and gives its answer.
// The Discord part (bot.js), the voice part (voice.js) and the console all talk to this.
import { system } from './prompt.js';
import { Memory } from './memory.js';
import { Interests } from './interests.js';
import { Quiet, command, called } from './quiet.js';
import * as personaMod from './persona.js';

export class Companion {
  constructor({ cfg, store, brains }) {
    Object.assign(this, { cfg, store, brains });
    this.memory = new Memory(store, brains);
    this.interests = new Interests(store, cfg.githubUser);
    this.quiet = new Quiet(store);
    this.persona = null;
    this.notices = [];                                  // what it wants to say on the side ("loading the model")
  }

  get off() { return !!this.store.state.off; }
  setting(key) { return this.store.state[key] ?? this.cfg[key]; }
  names() { return [this.persona?.name, ...(this.persona?.heardAs || [])].filter(Boolean); }

  async start(opts = {}) {
    this.persona = await personaMod.ensure(this.store, this.brains, this.cfg, opts);
    await this.interests.refresh().catch(() => {});
    return this.persona;
  }

  // A command said in plain words ("be quiet", its name): what it did, or null.
  plainCommand(text) {
    const c = command(text);
    if (c === 'quiet') { this.quiet.start(); return 'quiet'; }
    if (c === 'stop') return 'stop';
    if (this.quiet.on && called(text, this.names())) { this.quiet.end(); return 'called'; }
    return null;
  }

  // Its answer to what he said, in pieces. via: 'dm' | 'voice' | 'console'.
  async *reply(text, { via = 'dm', signal, onNotice } = {}) {
    if (!this.persona) await this.start({ onNotice });
    this.store.log({ role: 'him', text, via });
    const sys = system({
      persona: this.persona, notes: this.store.notes(), interests: this.interests.text(), summary: this.memory.summary(),
      languages: this.cfg.languages, mode: via === 'voice' ? 'voice' : 'dm', web: this.setting('web') !== false,
    });
    let out = '';
    try {
      for await (const piece of this.brains.stream({ system: sys, messages: this.memory.context(), maxTokens: via === 'voice' ? 300 : 900, signal }, { onNotice })) {
        out += piece;
        yield piece;
      }
    } finally {
      // what it got to say is what was said: an answer cut off by "quiet" is kept as far as it went
      if (out.trim()) this.store.log({ role: 'me', text: out.trim(), via, brain: this.brains.last?.name, cut: signal?.aborted || undefined });
    }
    this.memory.afterTurn().catch(() => {});
  }

  // A message it writes first (a check-in): one or two sentences from what it knows and what he did lately.
  async opener() {
    if (!this.persona) await this.start();
    await this.interests.refresh();
    const sys = system({ persona: this.persona, notes: this.store.notes(), interests: this.interests.text(), summary: this.memory.summary(), languages: this.cfg.languages });
    const text = await this.brains.ask(sys, '(He has not written today. Write him first: one or two sentences, about something of his you are curious about, ' +
      'or something he did lately. No greeting formula, no "how are you", nothing he must answer.)', { maxTokens: 150 });
    if (text) this.store.log({ role: 'me', text, via: 'dm', brain: this.brains.last?.name, first: true });
    return text;
  }

  async status() {
    const pick = await this.brains.pick({});
    const lines = [
      `I am ${this.persona?.name || '(not named yet)'}${this.off ? ', switched off' : ''}; ${this.quiet.describe()}.`,
      pick.brain ? `Thinking with ${pick.brain.label}${pick.brain.local ? '' : ' (outside your house)'}.` : `Nobody to think with: ${pick.why.join('; ')}.`,
      `I know ${this.store.notes().length} things about you. Web search: ${this.setting('web') !== false ? 'on' : 'off'}. Voice: I listen in mode "${this.setting('listen')}". Writing first: ${this.setting('checkin')}.`,
    ];
    return lines.join('\n');
  }
}
