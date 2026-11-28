// A brain that asks Claude through the Claude Code program itself (`claude -p`), with its
// owner's own login: the unmodified program, no tools, nothing of this machine's files. The
// login token is the program's own (CLAUDE_CODE_OAUTH_TOKEN, from `claude setup-token`); this
// code never reads it, it only hands the environment variable on to the program.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

export class ClaudeCodeBrain {
  constructor({ token = '', model = 'sonnet', bin = 'claude', web = true }) {
    Object.assign(this, { name: 'claude-code', label: 'Claude (through Claude Code)', local: false, token, model, bin, web });
    this.cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-cc-'));      // an empty folder: no project, no files
  }

  env() {
    const keep = ['PATH', 'HOME', 'LANG', 'TZ', 'NODE_EXTRA_CA_CERTS', 'CLAUDE_CONFIG_DIR', 'XDG_CONFIG_HOME'];
    const env = Object.fromEntries(keep.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
    if (this.token) env.CLAUDE_CODE_OAUTH_TOKEN = this.token;
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
    return env;
  }

  async ready() {
    if (this.ok !== undefined) return this.ok ? { ok: true } : { ok: false, why: this.why };
    const found = await new Promise((res) => {
      const p = spawn(this.bin, ['--version'], { env: this.env(), stdio: 'ignore' });
      p.on('error', () => res(false)); p.on('exit', (c) => res(c === 0));
    });
    this.ok = found; this.why = 'the claude program is not installed here';
    return found ? { ok: true } : { ok: false, why: this.why };
  }

  async *stream({ system, messages, signal }) {
    // one prompt per answer: the talk so far, then his new message
    const last = messages[messages.length - 1];
    const before = messages.slice(0, -1).map((m) => `${m.role === 'user' ? 'Him' : 'You'}: ${m.content}`).join('\n');
    const prompt = (before ? `The talk so far:\n${before}\n\n` : '') + `His new message:\n${last.content}\n\nAnswer him now, as yourself. Only your answer. ` +
      'You cannot see his computer: leave out anything you were told about this computer, its system or its folders.';
    // its only tools: searching and reading the web (they run at Anthropic, under his own login)
    const tools = this.web ? ['--tools', 'WebSearch,WebFetch', '--allowedTools', 'WebSearch,WebFetch'] : ['--tools', ''];
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--no-session-persistence',
      ...tools, '--disable-slash-commands', '--strict-mcp-config', '--setting-sources', '', '--system-prompt', system];
    if (this.model) args.push('--model', this.model);
    const child = spawn(this.bin, args, { env: this.env(), cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const stop = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', stop, { once: true });
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-600); });
    child.stdin.end(prompt);
    let streamed = false, result = '', failed = '';
    try {
      for await (const line of readline.createInterface({ input: child.stdout })) {
        let d; try { d = JSON.parse(line); } catch { continue; }
        if (d.type === 'stream_event' && d.event?.type === 'content_block_start' && d.event.content_block?.type === 'text' && streamed) {
          yield ' ';                                  // a new block after a search: keep the words apart
        } else if (d.type === 'stream_event' && d.event?.type === 'content_block_delta' && d.event.delta?.type === 'text_delta') {
          streamed = true;
          yield d.event.delta.text;
        } else if (d.type === 'result') {
          if (d.is_error) failed = String(d.result || d.subtype || 'error').slice(0, 300);
          else result = d.result || '';
        }
      }
      const code = await new Promise((res) => (child.exitCode !== null ? res(child.exitCode) : child.on('exit', res)));
      if (failed || (code !== 0 && !streamed && !result)) throw new Error('Claude Code: ' + (failed || err.trim().split('\n').pop() || 'exit ' + code));
      if (!streamed && result) yield result;
    } finally {
      signal?.removeEventListener('abort', stop);
      if (child.exitCode === null) child.kill('SIGTERM');
    }
  }
}
