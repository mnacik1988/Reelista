// Reelista — сервер распознавания речи для титров.
// Телефон присылает только звук (WAV 16 кГц моно, само видео не уходит),
// Whisper на Workers AI возвращает слова с таймкодами.
//
// Защита (ключей нет — модель вызывается через привязку AI):
//   • принимаем запросы только со своих страниц (Origin);
//   • не больше 6 распознаваний в минуту с одного IP;
//   • звук не больше 8 МБ (≈ 4 минуты) и только настоящий WAV;
//   • суточный потолок на весь сервис — чтобы чужой скрипт не выжег счёт.

const ALLOWED = ['https://mnacik1988.github.io', 'http://localhost:3480'];
const MAX_BYTES = 8 * 1024 * 1024;
const DAILY_CAP = 500;
const MODEL = '@cf/openai/whisper-large-v3-turbo';

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const okOrigin = ALLOWED.includes(origin);
    const cors = okOrigin ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {};

    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: okOrigin ? 204 : 403,
        headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }
      });
    }

    const url = new URL(req.url);
    if (url.pathname === '/health') return json({ ok: true }, 200, cors);
    if (req.method !== 'POST' || url.pathname !== '/transcribe') return json({ error: 'not_found' }, 404, cors);
    if (!okOrigin) return json({ error: 'forbidden' }, 403, cors);

    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.RL.limit({ key: ip });
    if (!success) return json({ error: 'rate_limited' }, 429, cors);

    if (Number(req.headers.get('Content-Length') || 0) > MAX_BYTES) return json({ error: 'too_large' }, 413, cors);
    const buf = await req.arrayBuffer();
    if (!buf.byteLength) return json({ error: 'empty' }, 400, cors);
    if (buf.byteLength > MAX_BYTES) return json({ error: 'too_large' }, 413, cors);
    if (ascii(buf, 0, 4) !== 'RIFF' || ascii(buf, 8, 12) !== 'WAVE') return json({ error: 'bad_audio' }, 400, cors);

    // Счётчик в KV приблизительный (KV не атомарен), но как потолок кошелька этого хватает.
    const key = 'n:' + new Date().toISOString().slice(0, 10);
    const used = Number(await env.DB.get(key)) || 0;
    if (used >= DAILY_CAP) return json({ error: 'daily_cap' }, 503, cors);
    await env.DB.put(key, String(used + 1), { expirationTtl: 3 * 86400 });

    const input = { audio: toBase64(buf) };
    const lang = url.searchParams.get('lang') || '';
    if (/^[a-z]{2}$/.test(lang)) input.language = lang;

    try {
      const out = await env.AI.run(MODEL, input);
      const words = [];
      for (const seg of out.segments || []) {
        for (const w of seg.words || []) {
          const t = String(w.word || '').trim();
          if (t) words.push({ w: t, s: round(w.start), e: round(w.end) });
        }
      }
      const language = (out.transcription_info && out.transcription_info.language) || '';
      return json({ text: out.text || '', language, words }, 200, cors);
    } catch (e) {
      console.error('whisper failed', e && e.message);
      return json({ error: 'ai_failed' }, 502, cors);
    }
  }
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
}
function ascii(buf, a, b) { return String.fromCharCode.apply(null, new Uint8Array(buf, a, b - a)); }
function round(x) { return Math.round(Number(x) * 1000) / 1000; }
function toBase64(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
