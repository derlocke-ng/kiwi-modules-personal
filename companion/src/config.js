// Settings from the environment. A secret NAME may also come from the file NAME_FILE.
import fs from 'node:fs';

const env = process.env;
const list = (v, d = '') => (v ?? d).split(',').map((s) => s.trim()).filter(Boolean);
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

function secret(name) {
  if (env[name]) return env[name].trim();
  const f = env[name + '_FILE'];
  return f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : '';
}

export function load() {
  return {
    dataDir: env.DATA_DIR || '/data',
    discordToken: secret('DISCORD_TOKEN'),
    owner: (env.OWNER || '').trim(),                    // the one person it answers: a user id or a user name
    languages: list(env.LANGUAGES, 'en,de'),
    name: (env.NAME || '').trim(),                      // empty: it names itself
    voice: (env.VOICE || '').trim(),                    // empty: it picks one
    voiceDe: (env.VOICE_DE || '').trim(),               // the voice for German sentences, when its own speaks English only
    githubUser: (env.GITHUB_USER || '').trim(),         // public repositories as a first list of interests
    brains: list(env.BRAINS, 'studio'),                 // who thinks, in this order: studio, claude-code, anthropic, openai
    studio: {
      url: (env.AI_URL || '').replace(/\/+$/, ''),
      key: secret('AI_KEY'),
      model: env.AI_MODEL || '',                        // loaded when nothing is loaded and AI_LOAD is on
      quant: env.AI_QUANT || '',
      context: int(env.AI_CONTEXT, 262144),
      mayLoad: bool(env.AI_LOAD, true),
      topK: int(env.AI_TOP_K, 20),
    },
    claudeCode: { token: secret('CLAUDE_CODE_OAUTH_TOKEN'), model: env.CLAUDE_MODEL || 'sonnet', bin: env.CLAUDE_BIN || 'claude' },
    anthropic: { key: secret('ANTHROPIC_API_KEY'), model: env.ANTHROPIC_MODEL || 'claude-opus-5-5' },
    openai: { url: (env.OPENAI_URL || 'https://api.openai.com').replace(/\/+$/, ''), key: secret('OPENAI_API_KEY'), model: env.OPENAI_MODEL || '' },
    listen: env.LISTEN || 'conversation',               // voice: conversation | name | always
    checkin: env.CHECKIN || 'off',                      // off, or "18:00-22:00" (one message a day in that window)
    speech: {
      dir: env.SPEECH_DIR || '/models',
      threads: int(env.SPEECH_THREADS, 4),
      endSilenceMs: int(env.END_SILENCE_MS, 1200),       // how long he must be silent before his sentence counts as over
    },
  };
}
