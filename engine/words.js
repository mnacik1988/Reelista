// Reelista — движок: Слова: чистка распознавания, поиск дублей, фразы титров, словарь замен.
// Чистая логика без экранов и кнопок. Вынесено из index.html (10.11.2026), чтобы рядом
// с веб-версией встали нативные модули оболочки (Capacitor) — см. platform.js.
// Классический скрипт: функции глобальные, данные берут из общего состояния S/X при вызове.

// Whisper отдаёт тире и знаки отдельными «словами» — оставляем только слова с буквами или цифрами.
// Отдельное тире приклеиваем к предыдущему слову как « —» (так пишут титры AFFX: «ПОМИЛКА —»).
var HAS_TEXT = /[0-9A-Za-zА-Яа-яЁёІіЇїЄєҐґÀ-ɏ]/;

function cleanWords(list) {
  var out = [];
  list.forEach(function (x) {
    var w = String(x.w || '').trim(), s = +x.s, e = +x.e;
    if (/^[-–—]+$/.test(w) && out.length) { out[out.length - 1].w += ' —'; return; }
    if (!HAS_TEXT.test(w) || !(e >= s)) return;
    var prev = out[out.length - 1];
    if (prev && s < prev.e) s = prev.e;      // слова не должны налезать друг на друга
    out.push({ w: w, s: s, e: Math.max(e, s + 0.05) });
  });
  return out;
}

var CAPITAL = /^[A-ZА-ЯЁІЇЄҐ]/;

function stem(w) {
  // Сравниваем по началу слова: «ошибка», «ошибки», «ошибку» — одно и то же.
  return w.toLowerCase().replace(/ё/g, 'е').replace(/[^0-9a-zа-яіїєґà-ɏ]/g, '').slice(0, 5);
}

function sentencesOf(words) {
  var out = [], cur = null;
  words.forEach(function (w) {
    var prev = cur && cur.words[cur.words.length - 1];
    if (!cur || w.c !== prev.c || w.s - prev.e > 0.6 || /[.!?…]$/.test(prev.w) ||
        (CAPITAL.test(w.w) && cur.words.length >= 2)) { cur = { words: [] }; out.push(cur); }
    cur.words.push(w);
  });
  out.forEach(function (s) {
    s.s = s.words[0].s; s.e = s.words[s.words.length - 1].e;
    s.toks = s.words.map(function (w) { return stem(w.w); }).filter(Boolean);
    s.text = s.words.map(function (w) { return w.w; }).join(' ');
  });
  return out;
}

function lcs(a, b) {
  var prev = new Array(b.length + 1).fill(0);
  for (var i = 0; i < a.length; i++) {
    var cur = [0];
    for (var j = 0; j < b.length; j++) cur[j + 1] = a[i] === b[j] ? prev[j] + 1 : Math.max(prev[j + 1], cur[j]);
    prev = cur;
  }
  return prev[b.length];
}

// Две фразы — дубли, если короткая почти целиком (по порядку) входит в длинную.
// «Первая ошибка…» + «Первая ошибка — длинное вступление» = дубль-обрыв и полный дубль.
function computeGroups() {
  var sents = sentencesOf(S.words), n = sents.length, parent = sents.map(function (_, i) { return i; });
  function find(x) { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; }
  for (var i = 0; i < n; i++) {
    for (var j = i + 1; j < n && j <= i + 12; j++) {
      var a = sents[i].toks, b = sents[j].toks;
      if (a.length < 2 || b.length < 2) continue;
      var l = lcs(a, b);
      if (l >= 2 && l / Math.min(a.length, b.length) >= 0.6 && l / Math.max(a.length, b.length) >= 0.35) parent[find(j)] = find(i);
    }
  }
  var map = {};
  sents.forEach(function (s, i) { var r = find(i); (map[r] = map[r] || []).push(s); });
  S.groups = Object.keys(map).map(function (k) { return map[k]; }).filter(function (t) { return t.length > 1; })
    .map(function (takes) {
      // Оставляем ПОСЛЕДНИЙ полный дубль: обычно его и записывали «начисто».
      var max = Math.max.apply(null, takes.map(function (t) { return t.toks.length; })), keep = 0;
      takes.forEach(function (t, i) { if (t.toks.length >= 0.7 * max) keep = i; });
      return { takes: takes, keep: keep, ignored: false };
    })
    .sort(function (x, y) { return x.takes[0].s - y.takes[0].s; });
}

function cutTakes() {
  if (!S.dupsOn) return 0;
  return S.groups.reduce(function (n, g) { return n + (g.ignored ? 0 : g.takes.length - 1); }, 0);
}

var SHORT = /^[a-zа-яёіїєґ]{1,2}$/;   // «в», «и», «на», «не» — не оставляем висеть в конце строки

function chars(ws) { return ws.reduce(function (s, w) { return s + w.w.length + 1; }, -1); }

// Режем речь на куски для показа. Сначала на предложения (пауза, знак конца, заглавная буква,
// вырез монтажа, другой ролик), потом длинное — на РАВНЫЕ части, а не «сколько влезло + огрызок».
function groupWords(words, maxChars, maxWords, splitCuts) {
  var sentences = [], cur = null;
  words.forEach(function (w) {
    var prev = cur && cur[cur.length - 1];
    var brk = !cur || w.c !== prev.c || w.s - prev.e > 0.45 || /[.!?…]$/.test(prev.w) ||
              (CAPITAL.test(w.w) && cur.length >= 2) || (splitCuts && cutBetween(prev.e, w.s));
    if (brk) { cur = []; sentences.push(cur); }
    cur.push(w);
  });

  var out = [];
  sentences.forEach(function (sent) {
    var n = Math.max(Math.ceil(chars(sent) / maxChars), Math.ceil(sent.length / maxWords));
    var parts = [], target = chars(sent) / n, part = [];
    sent.forEach(function (w, i) {
      var left = sent.length - i;
      if (part.length && parts.length < n - 1 &&
          (chars(part.concat(w)) > target * 1.15 || part.length >= maxWords) && left >= n - 1 - parts.length) {
        parts.push(part); part = [];
      }
      part.push(w);
    });
    parts.push(part);
    for (var i = 0; i < parts.length - 1; i++) {
      var last = parts[i][parts[i].length - 1];
      if (parts[i].length > 1 && SHORT.test(last.w)) parts[i + 1].unshift(parts[i].pop());
    }
    parts.forEach(function (p) { if (p.length) out.push({ words: p }); });
  });

  out.forEach(function (u, i) {
    u.s = u.words[0].s;
    var next = out[i + 1];
    // Фраза висит чуть дольше последнего слова, но не дольше начала следующей.
    u.end = Math.min(u.words[u.words.length - 1].e + 0.35, next ? next.words[0].s : Infinity);
  });
  return out;
}

function buildUnits() {
  if (!S.words) { S.units = []; return; }
  var st = STYLES[S.style];
  // Словарь замен — для всех стилей: Whisper путает бренды и англицизмы.
  var kept = applyRules(S.words.map(keptPart).filter(Boolean));
  if (st.custom) { S.units = affxPages(kept); return; }
  kept.forEach(function (w) { w.w = w.w.replace(/^~/, ''); });
  S.units = groupWords(kept, st.group[0], st.group[1], true);
}

function unitAt(t) {
  for (var i = 0; i < S.units.length; i++) {
    var u = S.units[i];
    if (t >= u.s && t < u.end) return u;
    if (u.s > t) break;
  }
  return null;
}

var LEAD = 0.04;                                    // слово и фраза появляются за 40 мс до начала

var AFFX_SHORT = /^(і|й|в|у|з|зі|із|на|та|а|чи|що|не|від|для|до|про|при|під|над|без|як|бо|об|и|с|к|о|по|за|но|из|же|ли)$/i;

// В спецификации «~16 букв», но по ручной нарезке эталонного ролика лучше всего совпадает 19:
// 24 фразы из 32 один в один (16 → 18, 20 → 23). Остальное — вкус, его правят в редакторе.
var AFFX_LETTERS = 19;

// Словарь замен: строки «было → стало». Сравниваем без регистра и знаков, по 1–3 словам подряд —
// Whisper то пишет «афілайт-маркетинг» одним словом, то двумя.
function parseRules(text) {
  return String(text || '').split('\n').map(function (line) {
    var m = line.split(/\s*(?:→|->|=>|=)\s*/);
    return m.length >= 2 && m[0].trim() && m[1].trim() ? { key: normKey(m[0]), to: m.slice(1).join(' ').trim() } : null;
  }).filter(function (r) { return r && r.key; });
}

function applyRules(words) {
  var rules = parseRules(AFFX.rules);
  if (!rules.length) return words;
  var out = [];
  for (var i = 0; i < words.length; i++) {
    var hit = null;
    for (var n = 3; n >= 1 && !hit; n--) {
      if (i + n > words.length) continue;
      var seg = words.slice(i, i + n);
      if (seg.some(function (w) { return w.c !== seg[0].c; })) continue;
      var key = seg.map(function (w) { return normKey(w.w); }).join('');
      for (var r = 0; r < rules.length; r++) if (rules[r].key === key) { hit = { seg: seg, to: rules[r].to }; break; }
    }
    if (!hit) { out.push(words[i]); continue; }
    var last = hit.seg[hit.seg.length - 1], tail = (last.w.match(/\s?[,.?!…:;—]+$/) || [''])[0];
    out.push(Object.assign({}, hit.seg[0], { w: hit.to + tail, e: last.e, br: last.br }));
    i += hit.seg.length - 1;
  }
  return out;
}

// Фразы «как у живого монтажёра»: 1–3 слова и не больше ~19 букв, конец после знака препинания,
// служебное слово («на», «і», «від»…) держится вместе со СЛЕДУЮЩИМ словом и не висит в конце,
// ручной разрыв/склейка из редактора (br) важнее правил. Сверено с фразами эталонного ролика:
// «працювати на когось» | «і чекати підвищення» | «дає тобі стабільність».
function isShort(w) { return AFFX_SHORT.test(normKey(w.w)); }

function isCap(w) { return /^\p{Lu}/u.test(w.w); }

function isLatin(w) { return /^[A-Za-z]/.test(w.w); }

function affxGroups(words) {
  var groups = [], cur = [];
  function hardEnd(w, next) { return !next || next.c !== w.c || w.br === 1 || (w.br !== 0 && /[,.?!…—:;]$/.test(w.w)); }
  function letters(list) { return letterCount(list.map(function (x) { return x.w; }).join('')); }
  words.forEach(function (w, i) {
    var next = words[i + 1], prev = cur[cur.length - 1];
    if (cur.length && prev.br !== 0 && !cur.every(isShort)) {
      // Заглавная буква — новое предложение («…маркетингу | Хочеш…»): Whisper часто теряет точку.
      // Не рвём только внутри латинского названия («AFFX Academy»), а «Тому» после него — уже новая фраза.
      var sentence = isCap(w) && !(isLatin(w) && isLatin(prev) && isCap(prev));
      // служебное слово проверяем вместе со следующим: если вдвоём не влезают — начинаем фразу с него
      var add = isShort(w) && next && !hardEnd(w, next) ? [w, next] : [w];
      if (sentence || cur.length + add.length > 3 || letters(cur.concat(add)) > AFFX_LETTERS) { groups.push(cur); cur = []; }
    }
    cur.push(w);
    if (hardEnd(w, next)) { groups.push(cur); cur = []; }
  });
  if (cur.length) groups.push(cur);
  return groups;
}

function affxPages(words) {
  var groups = affxGroups(words);
  return groups.map(function (ws, i) {
    var next = groups[i + 1], lastE = ws[ws.length - 1].e, end = Infinity;
    if (next) {
      var ns = next[0].s - LEAD;
      end = outTime(ns) - outTime(lastE) < 0.6 ? ns : lastE + 0.3;
    }
    return {
      // точку в конце убираем, запятые, «?» и «!» оставляем
      words: ws.map(function (w) { return Object.assign({}, w, { w: w.w.replace(/\.+$|…$/, '') }); }),
      // первая фраза видна уже на самом первом кадре — он часто становится обложкой
      start: i === 0 ? -1e9 : Math.max(0, ws[0].s - LEAD),
      end: end
    };
  });
}

function pageAt(t) {
  for (var i = 0; i < S.units.length; i++) { var p = S.units[i]; if (t >= p.start && t < p.end) return p; }
  return null;
}

// Акценты «Микса»: явные пометки из редактора (a) или разметка (~слово — зачеркнуть, СЛОВО — акцент).
// Если во фразе ничего не отмечено — сами предлагаем один акцент: число или самое длинное слово.
function mixFlags(words) {
  var marks = words.map(function (w) {
    var t = w.w.trim(), tilde = t.charAt(0) === '~', text = tilde ? t.slice(1) : t;
    var lettersOnly = text.replace(/[^\p{L}]/gu, '');
    var caps = lettersOnly.length >= 2 && lettersOnly === upperUk(lettersOnly);
    var a = w.a !== undefined ? w.a : tilde ? 2 : caps ? 1 : undefined;
    return { text: text, a: a };
  });
  if (!marks.some(function (m) { return m.a !== undefined; })) {
    var best = -1, score = 0;
    marks.forEach(function (m, i) {
      if (AFFX_SHORT.test(normKey(m.text))) return;
      var sc = /\d/.test(m.text) ? 100 : letterCount(m.text);
      if (sc >= 4 && sc > score) { score = sc; best = i; }
    });
    if (best >= 0) marks[best].a = 1;
  }
  return marks.map(function (m) { return { text: m.text, accent: m.a === 1 || m.a === 2, strike: m.a === 2 }; });
}
