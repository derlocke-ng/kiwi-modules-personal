// The Discord part: direct messages with its one person, the slash commands, and (voice.js)
// the voice channel. It answers nobody else, opens no port and leaves servers that are not
// its person's.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, GatewayIntentBits, Partials, Events, ChannelType, ApplicationCommandOptionType as Opt, MessageFlags } from 'discord.js';

const opt = (name, description, type, required = false, extra = {}) => ({ name, description, type, required, ...extra });
const COMMANDS = [
  { name: 'quiet', description: 'Be quiet: until you say my name or /talk, or for some minutes', options: [opt('minutes', 'For how many minutes', Opt.Integer, false, { min_value: 1, max_value: 1440 })] },
  { name: 'talk', description: 'Talk again' },
  { name: 'off', description: 'Switch me off: I answer nothing and use no model' },
  { name: 'on', description: 'Switch me on again' },
  { name: 'status', description: 'Who I am, what I think with, my settings' },
  { name: 'memory', description: 'What I know about you' },
  { name: 'remember', description: 'Tell me something to keep', options: [opt('what', 'What to remember', Opt.String, true)] },
  { name: 'forget', description: 'Forget one thing (its number in /memory), or all', options: [opt('what', 'A number, or: all', Opt.String, true)] },
  { name: 'interest', description: 'Something you are into, to talk about', options: [opt('what', 'The interest', Opt.String, true)] },
  { name: 'join', description: 'Come into the voice channel you are in' },
  { name: 'leave', description: 'Leave the voice channel' },
  { name: 'set', description: 'Change a setting', options: [
    opt('setting', 'Which one', Opt.String, true, { choices: ['listen', 'checkin', 'load', 'pause', 'name', 'voice'].map((v) => ({ name: v, value: v })) }),
    opt('value', 'listen: conversation|name|always; checkin: off or 18:00-22:00; load: on|off; pause: ms; name; voice', Opt.String, true)] },
].map((c) => ({ ...c, contexts: [0, 1], integration_types: [0] }));          // in servers and in its own DMs

export function chunks(text, max = 1900) {              // Discord takes 2000 characters a message
  const out = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = Math.max(rest.lastIndexOf('\n\n', max), rest.lastIndexOf('\n', max), rest.lastIndexOf('. ', max) + 1);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export function parseSetting(setting, value) {          // -> {key: value} for the state, or an error text
  const v = String(value).trim();
  if (setting === 'listen') return ['conversation', 'name', 'always'].includes(v) ? { listen: v } : 'listen: conversation (I stay in the talk once called), name (only when called), always';
  if (setting === 'checkin') return v === 'off' || /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(v) ? { checkin: v } : 'checkin: off, or a time window like 18:00-22:00';
  if (setting === 'load') return ['on', 'off'].includes(v) ? { load: v === 'on' } : 'load: on or off (may I load the model at home when none is loaded)';
  if (setting === 'pause') return /^\d{3,4}$/.test(v) && +v >= 300 && +v <= 3000 ? { pause: +v } : 'pause: 300 to 3000 (milliseconds of silence that end your sentence)';
  if (setting === 'name') return /^[\p{L}][\p{L}' -]{1,19}$/u.test(v) ? { name: v } : 'name: letters only, up to 20';
  if (setting === 'voice') return { voice: v };
  return 'no such setting';
}

export async function startBot({ cfg, store, companion, say }) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel, Partials.Message],
  });
  let voice = null;                                     // the voice part, loaded when first asked for

  const isOwner = (user) => {
    const pinned = store.state.ownerId;
    if (pinned) return user.id === pinned;
    if (/^\d{15,22}$/.test(cfg.owner)) return user.id === cfg.owner;
    if (user.username?.toLowerCase() !== cfg.owner.toLowerCase()) return false;
    store.setState({ ownerId: user.id });               // from now on only this account counts, whatever it is called
    say('my person is the account', user.id);
    return true;
  };
  const ownerId = () => store.state.ownerId || (/^\d{15,22}$/.test(cfg.owner) ? cfg.owner : null);

  const applySettings = () => {
    const st = store.state;
    if (typeof st.load === 'boolean') cfg.studio.mayLoad = st.load;
    if (st.name && companion.persona) companion.persona.name = st.name;
    if (st.voice && companion.persona) companion.persona.voice = st.voice;
  };

  const leaveForeign = async (guild) => {               // a server that is not its person's: out
    try {
      const owner = await guild.fetchOwner();
      if (!isOwner(owner.user)) { say('leaving a server that is not my person\'s'); await guild.leave(); }
    } catch (e) { say('could not check a server:', e.message); }
  };

  const presence = () => client.user?.setPresence({
    status: companion.off ? 'dnd' : companion.quiet.on ? 'idle' : 'online',
    activities: [{ type: 4, name: 'status', state: companion.off ? 'switched off' : companion.quiet.on ? 'quiet' : 'here' }],
  });

  client.once(Events.ClientReady, async () => {
    say('signed in as', client.user.tag);
    await client.application.commands.set(COMMANDS).catch((e) => say('commands:', e.message));
    for (const g of client.guilds.cache.values()) await leaveForeign(g);
    await companion.start({ onNotice: say }).catch((e) => say('start:', e.message));
    applySettings();
    presence();
    setInterval(() => checkin().catch(() => {}), 60 * 1000);
    // a sign of life for the container's health check: touched while the connection to Discord stands
    const alive = () => { if (client.ws.status === 0) fs.writeFileSync(path.join(os.tmpdir(), 'alive'), String(Date.now())); };
    alive(); setInterval(alive, 30 * 1000);
  });
  client.on(Events.GuildCreate, leaveForeign);
  client.on(Events.VoiceStateUpdate, (_old, now) => {          // he left the channel: so does it
    if (voice?.channelId && now.id === ownerId() && now.channelId !== voice.channelId) voice.leave();
  });

  // one answer at a time, in the order he wrote
  let chain = Promise.resolve();
  const inOrder = (fn) => { chain = chain.then(fn).catch((e) => say('error:', e.message)); return chain; };
  let saidOff = 0;

  client.on(Events.MessageCreate, (message) => {
    if (message.author.bot || message.channel.type !== ChannelType.DM || !isOwner(message.author)) return;
    const text = message.content.trim();
    if (!text) return;
    inOrder(async () => {
      if (companion.off) {
        if (Date.now() - saidOff > 10 * 60 * 1000) { saidOff = Date.now(); await message.channel.send('I am switched off. /on wakes me.'); }
        return;
      }
      const cmd = companion.plainCommand(text);
      if (cmd === 'quiet' || cmd === 'stop') {
        voice?.hush();
        presence();
        if (cmd === 'quiet') await message.channel.send('Okay. Quiet until you say my name or /talk.');
        return;
      }
      if (cmd === 'called') presence();
      await message.channel.sendTyping().catch(() => {});
      const typing = setInterval(() => message.channel.sendTyping().catch(() => {}), 8000);
      let out = '';
      try {
        for await (const piece of companion.reply(text, { via: 'dm', onNotice: (t) => message.channel.send(t).catch(() => {}) })) out += piece;
        const b = companion.brains.last;
        if (b && !b.local) out += `\n-# answered by ${b.label}, outside your house`;
      } catch (e) {
        out = out || String(e.message || e).slice(0, 600);
      } finally { clearInterval(typing); }
      for (const part of chunks(out)) await message.channel.send(part);
    });
  });

  client.on(Events.InteractionCreate, async (i) => {
    if (!i.isChatInputCommand()) return;
    const hidden = i.inGuild() ? { flags: MessageFlags.Ephemeral } : {};
    if (!isOwner(i.user)) { await i.reply({ content: 'I talk to one person only.', flags: MessageFlags.Ephemeral }).catch(() => {}); return; }
    try {
      const what = i.options.getString('what') || '';
      switch (i.commandName) {
        case 'quiet': { const m = i.options.getInteger('minutes') || 0; companion.quiet.start(m); voice?.hush(); await i.reply({ content: m ? `Quiet for ${m} minutes.` : 'Quiet until you say my name or /talk.', ...hidden }); break; }
        case 'talk': companion.quiet.end(); await i.reply({ content: 'I am here.', ...hidden }); break;
        case 'off': store.setState({ off: true }); voice?.leave(); await i.reply({ content: 'Switched off. I answer nothing and use no model until /on.', ...hidden }); break;
        case 'on': store.setState({ off: false }); await i.reply({ content: 'Switched on.', ...hidden }); break;
        case 'status': await i.deferReply(hidden); await i.editReply(await companion.status()); break;
        case 'memory': {
          const notes = store.notes();
          const text = notes.length ? notes.map((n) => `${n.id}. ${n.text}`).join('\n') : 'Nothing yet.';
          const mine = companion.interests.mine().mine;
          const all = `What I know about you:\n${text}` + (mine.length ? `\n\nYour interests, as you told me:\n${mine.map((m) => `- ${m}`).join('\n')}` : '') +
            '\n\n/forget N removes one, /forget all removes everything, the talk so far included.';
          if (all.length < 1900) await i.reply({ content: all, ...hidden });
          else await i.reply({ content: 'What I know about you, as a file:', files: [{ attachment: Buffer.from(all), name: 'memory.txt' }], ...hidden });
          break;
        }
        case 'remember': { const n = store.addNote(what); await i.reply({ content: n ? `Kept (${n.id}).` : 'I knew that already.', ...hidden }); break; }
        case 'forget': {
          const w = what.trim().toLowerCase();
          if (w !== 'all' && !/^\d+$/.test(w)) { await i.reply({ content: 'A number from /memory, or: all', ...hidden }); break; }
          const n = store.forget(w);
          await i.reply({ content: n === -1 ? 'Forgotten: everything I knew about you and our talk so far.' : n ? 'Forgotten.' : 'There is no such number.', ...hidden });
          break;
        }
        case 'interest': companion.interests.add(what); await i.reply({ content: 'Noted.', ...hidden }); break;
        case 'join': {
          await i.deferReply(hidden);
          if (companion.off) { await i.editReply('I am switched off. /on first.'); break; }
          let channel = null;
          for (const g of client.guilds.cache.values()) channel ||= g.voiceStates.cache.get(i.user.id)?.channel;
          if (!channel) { await i.editReply('You are in no voice channel that I can see. Join one first.'); break; }
          voice ||= await (await import('./voice.js')).makeVoice({ cfg, store, companion, say, presence });
          await i.editReply(await voice.join(channel, i.user.id));
          break;
        }
        case 'leave': voice?.leave(); await i.reply({ content: 'Left.', ...hidden }); break;
        case 'set': {
          const r = parseSetting(i.options.getString('setting'), i.options.getString('value'));
          if (typeof r === 'string') { await i.reply({ content: r, ...hidden }); break; }
          store.setState(r); applySettings(); voice?.settingsChanged();
          await i.reply({ content: 'Set.', ...hidden });
          break;
        }
        default: await i.reply({ content: 'I do not know that command.', ...hidden });
      }
      presence();
    } catch (e) {
      say('command', i.commandName, 'failed:', e.message);
      const msg = { content: 'That did not work: ' + String(e.message).slice(0, 300), ...hidden };
      await (i.deferred || i.replied ? i.editReply(msg) : i.reply(msg)).catch(() => {});
    }
  });

  // Writing first: at most once a day, at a random minute of the window he set, never while
  // quiet or off, and only when he has not written that day.
  async function checkin() {
    const win = companion.setting('checkin');
    const id = ownerId();
    if (!id || !win || win === 'off' || companion.off || companion.quiet.on) return;
    const now = new Date();
    const day = now.toLocaleDateString('sv');
    const st = store.state;
    if (st.checkinDay === day) return;
    const [from, to] = win.split('-').map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));
    const minute = now.getHours() * 60 + now.getMinutes();
    if (st.checkinPlan?.day !== day) store.setState({ checkinPlan: { day, minute: from + Math.floor(Math.random() * Math.max(1, to - from)) } });
    if (minute < store.state.checkinPlan.minute || minute > to) return;
    store.setState({ checkinDay: day });
    if (store.recent(40).some((e) => e.role === 'him' && String(e.t).slice(0, 10) === now.toISOString().slice(0, 10))) return;
    const text = await companion.opener();
    if (text) await (await client.users.fetch(id)).send(chunks(text)[0]);
  }

  process.on('SIGTERM', () => { voice?.leave(); client.destroy(); process.exit(0); });
  await client.login(cfg.discordToken);
  return client;
}
