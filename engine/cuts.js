// Reelista — движок: Что вырезать: общая шкала роликов, паузы, дубли, оставшиеся куски.
// Чистая логика без экранов и кнопок. Вынесено из index.html (10.11.2026), чтобы рядом
// с веб-версией встали нативные модули оболочки (Capacitor) — см. platform.js.
// Классический скрипт: функции глобальные, данные берут из общего состояния S/X при вызове.

function layoutClips() {
  var t = 0;
  S.clips.forEach(function (c) { c.offset = t; t += c.dur; });
  S.duration = t;
}

function clipAt(T) {
  var c = S.clips[0];
  for (var i = 1; i < S.clips.length; i++) if (S.clips[i].offset <= T) c = S.clips[i];
  return c;
}

function clipById(id) { for (var i = 0; i < S.clips.length; i++) if (S.clips[i].id === id) return S.clips[i]; return null; }

function pauseCutsFor(c) {
  var cuts = pauseCutsLocal(c);
  // Дубль, остановленный жестом: хвост с поднятой рукой отрезаем всегда (trimEnd — секунда от начала файла).
  if (c.trimEnd > 0.2 && c.trimEnd < c.dur - 0.05) cuts.push([c.trimEnd, c.dur]);
  return cuts.map(function (x) { return [x[0] + c.offset, x[1] + c.offset]; });
}

function pauseCutsLocal(c) {
  var L = LEVELS[S.level], sp = c.sp, n = sp.length, cuts = [], k, s;
  if (c.flat) return cuts;
  var first = -1, last = -1;
  for (k = 0; k < n; k++) if (sp[k]) { if (first < 0) first = k; last = k; }
  if (first < 0) return cuts;
  var minF = Math.round(L.minPause / HOP);
  // Начало и конец каждого дубля (тянулись к кнопке, молчали в конце) режем при любой длине.
  var headEnd = first * HOP - L.pad;
  if (headEnd > 0.05) cuts.push([0, headEnd]);
  for (k = first; k <= last;) {
    if (!sp[k]) {
      s = k; while (k <= last && !sp[k]) k++;
      if (k - s >= minF) {
        var a = s * HOP + L.pad, b = k * HOP - L.pad;
        if (b - a > 0.05) cuts.push([a, b]);
      }
    } else k++;
  }
  var tail = (last + 1) * HOP + L.pad;
  if (c.dur - tail > 0.05) cuts.push([tail, c.dur]);
  return cuts;
}

function rebuild() {
  S.pauseCuts = [].concat.apply([], S.clips.map(pauseCutsFor));
  rebuildCuts();
}

// Границы дубля от Whisper неточны: конец слова он ставит раньше, чем стихает звук (замер:
// «длинное…» по Whisper до 2.82 с, по звуку до 3.35 с — оставался огрызок слога). Поэтому
// вырез дубля дотягиваем ПО ЗВУКУ: вперёд — до начала следующей речи, назад — до конца
// предыдущей (если дубль начинается в тишине). Минус запас у слов, как у обычных пауз.
// Тянем вперёд, только если за дублем в пределах 0.8 с есть настоящая тишина (≥ 0.15 с):
// если человек оборвал фразу и сразу, без паузы, начал заново — режем по границе Whisper,
// иначе звуковой поиск прошёл бы сквозь хороший дубль.
function dupCut(t) {
  var c = clipAt(t.s), sp = c.sp, n = sp.length, pad = LEVELS[S.level].pad;
  var ks = Math.max(0, Math.min(n - 1, Math.floor((t.s - c.offset) / HOP)));
  var ke = Math.max(0, Math.min(n - 1, Math.floor((t.e - c.offset) / HOP)));
  var next = -1;
  for (var j = ke; j < Math.min(n, ke + 80); j++) {
    if (sp[j]) continue;
    var q = j; while (q < n && !sp[q]) q++;
    if (q - j >= 15 || q >= n) { next = q; break; }
    j = q;
  }
  var end = next < 0 ? t.e - c.offset + 0.03 : next >= n ? c.dur : Math.max(t.e - c.offset, next * HOP - pad);
  var start = t.s - c.offset, k;
  if (!sp[ks]) {
    k = ks;
    while (k > 0 && !sp[k]) k--;
    start = k <= 0 ? 0 : Math.min(start, (k + 1) * HOP + pad);
  }
  return [c.offset + start, c.offset + end];
}

function rebuildCuts() {
  var cuts = S.pauseCuts.slice();
  if (S.dupsOn) S.groups.forEach(function (g) {
    if (g.ignored) return;
    g.takes.forEach(function (t, i) { if (i !== g.keep) cuts.push(dupCut(t)); });
  });
  cuts.sort(function (a, b) { return a[0] - b[0]; });
  var merged = [];
  cuts.forEach(function (c) {
    var a = Math.max(0, c[0]), b = Math.min(S.duration, c[1]);
    if (b <= a) return;
    var last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else merged.push([a, b]);
  });
  S.cuts = merged;

  // Оставшееся — дополнение к вырезам, разрезанное по границам роликов (кусок не может жить в двух файлах).
  var keep = [], t = 0;
  merged.forEach(function (c) { if (c[0] - t > 0.01) keep.push([t, c[0]]); t = c[1]; });
  if (S.duration - t > 0.01) keep.push([t, S.duration]);
  if (!keep.length) keep = [[0, S.duration]];
  var split = [];
  keep.forEach(function (k) {
    var a = k[0];
    S.clips.forEach(function (c) { if (c.offset > a + 0.01 && c.offset < k[1] - 0.01) { split.push([a, c.offset]); a = c.offset; } });
    split.push([a, k[1]]);
  });
  S.keep = split.filter(function (k) { return k[1] - k[0] > 0.05; });
  S.segs = S.keep.map(function (k) {
    var c = clipAt((k[0] + k[1]) / 2);
    return { clip: c, a: k[0] - c.offset, b: k[1] - c.offset };
  });
  buildUnits();
}

function keptLength() { return S.keep.reduce(function (s, k) { return s + k[1] - k[0]; }, 0); }

function inCut(t) { for (var i = 0; i < S.cuts.length; i++) if (t >= S.cuts[i][0] && t < S.cuts[i][1]) return true; return false; }

function nextKeepStart(t) {
  for (var i = 0; i < S.keep.length; i++) if (S.keep[i][1] > t + 0.01) return Math.max(t, S.keep[i][0]);
  return null;
}

function cutBetween(a, b) {
  for (var i = 0; i < S.cuts.length; i++) if (S.cuts[i][0] < b && S.cuts[i][1] > a) return true;
  return false;
}

// Whisper любит растягивать первое слово после паузы на всю паузу (замер: «Зритель» 10.06–11.92 с).
// Поэтому слово живёт, пока заметная его часть звучит в ролике, а время обрезаем до этой части.
// Если кусков несколько — берём последний: растянуто начало слова, а не конец.
function keptPart(w) {
  var s = null, e = null;
  for (var i = 0; i < S.keep.length; i++) {
    var a = Math.max(w.s, S.keep[i][0]), b = Math.min(w.e, S.keep[i][1]);
    if (b - a > 0.08) { s = a; e = b; }
  }
  return s === null ? null : { w: w.w, c: w.c, s: s, e: e, a: w.a, br: w.br, src: w };
}

// Обратно к outTime: время итогового ролика → время на общей шкале исходников.
// Нужно второму проходу сборки: титры рисуются поверх уже нарезанного файла (нативная нарезка),
// а слова и фразы живут на шкале исходников. Считаем по тем же кускам, что и склейка (S.segs).
function srcTime(o) {
  for (var i = 0; i < S.segs.length; i++) {
    var sg = S.segs[i], d = sg.b - sg.a;
    if (o < d || i === S.segs.length - 1) return sg.clip.offset + sg.a + Math.min(o, d);
    o -= d;
  }
  return 0;
}

// Время на смонтированной шкале — для правила «пауза до следующей фразы больше 600 мс».
function outTime(t) {
  var o = 0;
  for (var i = 0; i < S.keep.length; i++) {
    var k = S.keep[i];
    if (t >= k[1]) o += k[1] - k[0];
    else { if (t > k[0]) o += t - k[0]; break; }
  }
  return o;
}
