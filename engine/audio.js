// Reelista — движок: Звук: чтение дорожки, декодирование, громкость для поиска пауз, 16 кГц для распознавания.
// Чистая логика без экранов и кнопок. Вынесено из index.html (10.11.2026), чтобы рядом
// с веб-версией встали нативные модули оболочки (Capacitor) — см. platform.js.
// Классический скрипт: функции глобальные, данные берут из общего состояния S/X при вызове.

function decodeWith(ctx, buf) {
  return new Promise(function (res, rej) {
    // Старый Safari понимает только колбэки, новый — промис; поддерживаем оба.
    var p = ctx.decodeAudioData(buf, res, function (e) { rej(e || new Error('decode')); });
    if (p && p.then) p.then(res, rej);
  });
}

// Раньше на КАЖДЫЙ файл создавался свой AudioContext, а iOS держит их одновременно лишь несколько —
// на нескольких дублях разбор звука падал. Теперь один общий «тихий» OfflineAudioContext:
// он не занимает звук телефона и живёт всё время.
var DEC = null;

function decoderCtx() {
  if (!DEC) {
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    try { DEC = new OAC(1, 1, 44100); } catch (e) { DEC = null; }
  }
  return DEC;
}

function decodeSmall(buf) {
  var ctx = decoderCtx();
  // decodeAudioData «забирает» буфер даже при неудаче, поэтому на первую попытку отдаём копию.
  return (ctx ? decodeWith(ctx, buf.slice(0)) : Promise.reject(new Error('no offline context'))).catch(function () {
    var AC = window.AudioContext || window.webkitAudioContext, ac = new AC();
    function close() { try { ac.close(); } catch (x) {} }
    return decodeWith(ac, buf).then(function (a) { close(); return a; }, function (e) { close(); throw e; });
  });
}

// Отрезаем «разгон» кодировщика AAC, который плеер не показывает, — иначе паузы и слова съедут на ~45 мс.
function trimStart(ab, sec) {
  var n = Math.round(sec * ab.sampleRate);
  if (!(n > 0) || n >= ab.length || sec > 1) return ab;
  var ctx = decoderCtx() || new (window.AudioContext || window.webkitAudioContext)();
  var out = ctx.createBuffer(ab.numberOfChannels, ab.length - n, ab.sampleRate);
  for (var c = 0; c < ab.numberOfChannels; c++) out.getChannelData(c).set(ab.getChannelData(c).subarray(n));
  return out;
}

// Главный путь: из MP4/MOV достаём только звуковую дорожку (audio-track.js) — 1–2 МБ на минуту
// вместо всего файла. Минута 4K с iPhone весит 300–400 МБ, и целиком Safari её не переваривал.
function readAudio(f) {
  var extract = window.ReelistaAudio ? ReelistaAudio.extract(f) : Promise.reject(new Error('нет модуля звука'));
  return extract.then(function (r) {
    return decodeSmall(r.adts).then(function (ab) { return trimStart(ab, r.priming); });
  }).catch(function (first) {
    if (first && first.noAudio) throw first;           // звука нет совсем — читать целиком бессмысленно
    console.warn('звуковая дорожка не досталась, читаю файл целиком', first);
    return readWhole(f).catch(function (e) {
      throw new Error(errText(first) + ' / ' + errText(e));
    });
  });
}

// Запасной путь — весь файл целиком (не MP4/MOV, звук не AAC, «нарезанный» MP4 из MediaRecorder).
function readWhole(f) {
  return f.arrayBuffer().then(function (buf) {
    var ctx = decoderCtx();
    if (!ctx) throw new Error('no offline context');
    return decodeWith(ctx, buf);
  }).catch(function (first) {
    // Запасной путь — обычный AudioContext. Файл читаем заново: декодер «забирает» буфер себе.
    console.warn('offline decode failed', first);
    var AC = window.AudioContext || window.webkitAudioContext, ctx = new AC();
    function close() { try { ctx.close(); } catch (x) {} }
    return f.arrayBuffer().then(function (buf) { return decodeWith(ctx, buf); })
      .then(function (a) { close(); return a; }, function (e) { close(); throw e; });
  });
}

// Громкость каждые 10 мс; порог «тишина/речь» у КАЖДОГО ролика свой — дубли могли сниматься в разном шуме.
function analyseClip(c, ab) {
  var sr = ab.sampleRate, win = Math.round(sr * HOP), n = Math.floor(ab.length / win);
  var ch = [], nc = ab.numberOfChannels, i, j, k;
  for (k = 0; k < nc; k++) ch.push(ab.getChannelData(k));
  var db = new Float32Array(n);
  for (i = 0; i < n; i++) {
    var sum = 0, o = i * win;
    for (j = 0; j < win; j++) {
      var x = 0;
      for (k = 0; k < nc; k++) x += ch[k][o + j];
      x /= nc; sum += x * x;
    }
    db[i] = 10 * Math.log10(sum / win + 1e-12);
  }
  var sorted = Float32Array.from(db).sort();
  var floor = sorted[Math.floor(n * 0.10)] || -120, peak = sorted[Math.floor(n * 0.95)] || -120;
  var thr = floor + (peak - floor) * 0.30, range = peak - floor + 1e-6;
  c.dur = ab.duration;
  c.flat = !n || peak - floor < 6;   // ровный звук: речь от паузы не отличить
  c.lvl = new Float32Array(n);
  c.sp = new Uint8Array(n);
  for (i = 0; i < n; i++) {
    c.lvl[i] = Math.max(0, Math.min(1, (db[i] - floor) / range));
    c.sp[i] = db[i] >= thr ? 1 : 0;
  }
  for (i = 0; i < n;) {
    if (c.sp[i]) { var s = i; while (i < n && c.sp[i]) i++; if (i - s < MIN_SPEECH) for (j = s; j < i; j++) c.sp[j] = 0; }
    else i++;
  }
}

// Моно 16 кГц: усредняем исходные отсчёты в каждом новом интервале (заодно срезает высокие частоты).
function to16k(ab) {
  var sr = ab.sampleRate, ratio = sr / 16000, n = Math.floor(ab.length / ratio);
  var ch = [], nc = ab.numberOfChannels, c;
  for (c = 0; c < nc; c++) ch.push(ab.getChannelData(c));
  var out = new Int16Array(n);
  for (var i = 0; i < n; i++) {
    var a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio)), sum = 0;
    for (var j = a; j < b; j++) for (c = 0; c < nc; c++) sum += ch[c][j] || 0;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(sum / ((b - a) * nc) * 32767)));
  }
  return out;
}

function makeWav(pcm) {
  var buf = new ArrayBuffer(44 + pcm.length * 2), d = new DataView(buf);
  function str(o, s) { for (var i = 0; i < s.length; i++) d.setUint8(o + i, s.charCodeAt(i)); }
  str(0, 'RIFF'); d.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, 16000, true); d.setUint32(28, 32000, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true);
  str(36, 'data'); d.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return buf;
}
