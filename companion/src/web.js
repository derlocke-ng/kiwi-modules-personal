// Looking things up, done by the companion itself, so that it works with every brain: a
// search through SearXNG (the container next to it, which asks the search engines) and
// reading one page. Pages on the home network are never read: a web page could ask for them.
import dns from 'node:dns/promises';
import net from 'node:net';

export const TOOLS = [
  { type: 'function', function: { name: 'web_search', description: 'Search the web. Returns the top results with title, address and a snippet.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to search for, in the words a search engine understands' },
      language: { type: 'string', description: 'en or de: the language of the pages wanted' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'read_page', description: 'Read the text of one web page, from a search result.',
    parameters: { type: 'object', properties: { url: { type: 'string', description: 'The https address of the page' } }, required: ['url'] } } },
];

const PRIVATE4 = [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8], ['169.254.0.0', 16], ['100.64.0.0', 10], ['0.0.0.0', 8]];
const toInt = (ip) => ip.split('.').reduce((a, b) => (a << 8) + Number(b), 0) >>> 0;
export function isPrivate(ip) {
  if (net.isIPv4(ip)) return PRIVATE4.some(([base, bits]) => (toInt(ip) >>> (32 - bits)) === (toInt(base) >>> (32 - bits)));
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivate(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

export function pageText(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  let t = html.replace(/<(script|style|noscript|svg|nav|footer|header|aside|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n[\s]*/g, '\n').trim();
  return { title: title.replace(/\s+/g, ' ').trim(), text: t };
}

export class Web {
  constructor({ searchUrl, say = () => {} }) { this.searchUrl = (searchUrl || '').replace(/\/+$/, ''); this.say = say; }

  get on() { return !!this.searchUrl; }

  async run(name, args) {                               // -> text for the model
    try {
      if (name === 'web_search') return await this.search(String(args.query || ''), args.language);
      if (name === 'read_page') return await this.read(String(args.url || ''));
      return 'No such tool.';
    } catch (e) { return 'That did not work: ' + String(e.message || e).slice(0, 200); }
  }

  async search(query, language) {
    if (!query.trim()) return 'No query given.';
    const q = new URLSearchParams({ q: query, format: 'json', safesearch: '0' });
    if (language === 'de' || language === 'en') q.set('language', language);
    const r = await fetch(`${this.searchUrl}/search?${q}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('the search says ' + r.status);
    const d = await r.json();
    const results = (d.results || []).slice(0, 6);
    this.say?.(`web: searched (${results.length} results)`);
    if (!results.length) return 'No results.';
    return results.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${String(x.content || '').replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
  }

  async read(address) {
    let u;
    try { u = new URL(address); } catch { return 'Not a web address.'; }
    if (!/^https?:$/.test(u.protocol)) return 'Only http and https pages.';
    if (/\.(home|local|lan|internal|localhost)$/i.test(u.hostname) || u.hostname === 'localhost') return 'Pages on the home network are not read.';
    const addrs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await dns.lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivate(a.address))) return 'Pages on the home network are not read.';
    const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) companion', Accept: 'text/html,text/plain' } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) return this.readOnce(new URL(r.headers.get('location'), u).href);
    if (!r.ok) return `The page says ${r.status}.`;
    const type = r.headers.get('content-type') || '';
    if (!/text\/(html|plain)|xhtml/.test(type)) return 'That is not a page with text (' + type.split(';')[0] + ').';
    const reader = r.body.getReader();
    let got = 0; const parts = [];
    for (;;) { const { done, value } = await reader.read(); if (done) break; got += value.length; parts.push(value); if (got > 2_000_000) { reader.cancel(); break; } }
    const html = Buffer.concat(parts).toString('utf8');
    const { title, text } = type.includes('html') ? pageText(html) : { title: '', text: html };
    this.say?.('web: read a page');
    return (title ? title + '\n\n' : '') + text.slice(0, 7000);
  }

  async readOnce(address) { this.redirected = (this.redirected || 0) + 1; if (this.redirected > 3) return 'Too many redirects.'; try { return await this.read(address); } finally { this.redirected--; } }
}
