// Reelista — движок: Рисование титров: одни и те же функции для превью, плиток стилей и сборки ролика.
// Чистая логика без экранов и кнопок. Вынесено из index.html (10.11.2026), чтобы рядом
// с веб-версией встали нативные модули оболочки (Capacitor) — см. platform.js.
// Классический скрипт: функции глобальные, данные берут из общего состояния S/X при вызове.

// Один рисовальщик для превью стилей, просмотра и сборки — что видно на экране, то и в ролике.
function drawUnit(g, W, H, words, active, st, base, cy) {
  var fs = Math.round(base * st.fs), plate = st.hl === 'plate';
  g.save();
  g.font = st.weight + ' ' + fs + 'px -apple-system, "SF Pro Display", "Segoe UI", Roboto, sans-serif';
  g.textBaseline = 'middle'; g.lineJoin = 'round';
  // У плашки нужен воздух, иначе она налезает на соседние слова.
  var space = g.measureText(' ').width + (plate ? fs * 0.3 : 0), maxW = W * 0.86, lineH = fs * (plate ? 1.4 : 1.25);

  var lines = [[]], lw = [0];
  words.forEach(function (w, i) {
    var text = st.upper ? w.w.toUpperCase() : w.w, ww = g.measureText(text).width, L = lines.length - 1;
    if (lines[L].length && lw[L] + space + ww > maxW) { lines.push([]); lw.push(0); L++; }
    lw[L] += (lines[L].length ? space : 0) + ww;
    lines[L].push({ text: text, width: ww, i: i });
  });
  var y0 = cy - (lines.length - 1) * lineH / 2;

  if (st.box) {
    var bw = Math.max.apply(null, lw) + fs * 1.0, bh = lines.length * lineH + fs * 0.45;
    g.fillStyle = 'rgba(14,14,16,0.72)';
    roundRect(g, (W - bw) / 2, y0 - lineH / 2 - fs * 0.22, bw, bh, fs * 0.35);
    g.fill();
  }
  lines.forEach(function (line, L) {
    var x = (W - lw[L]) / 2, y = y0 + L * lineH;
    line.forEach(function (it) {
      var on = it.i === active && st.hl !== 'none';
      if (plate && on) {
        var p = fs * 0.14;
        g.fillStyle = st.plate;
        roundRect(g, x - p, y - fs * 0.62, it.width + p * 2, fs * 1.24, fs * 0.2);
        g.fill();
      } else if (st.stroke) {
        g.lineWidth = fs * st.stroke;
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.strokeText(it.text, x, y);
      }
      g.fillStyle = plate && on ? (st.plateText || '#fff') : (st.hl === 'color' && on ? st.color : (st.box ? '#E8E8EA' : '#fff'));
      g.fillText(it.text, x, y);
      x += it.width + space;
    });
  });
  g.restore();
}

function drawSubs(g, W, H, t) {
  if (!S.subsOn || !S.units.length) return;
  var cst = STYLES[S.style].custom;
  if (cst === 'plate') return drawAffxPlate(g, W, H, t);
  if (cst === 'mix') return drawAffxMix(g, W, H, t);
  var u = unitAt(t);
  if (!u) return;
  // Активное слово — последнее начавшееся: между словами подсветка не мигает.
  var active = -1;
  u.words.forEach(function (w, i) { if (t >= w.s) active = i; });
  var st = STYLES[S.style];
  drawUnit(g, W, H, u.words, active, st, Math.min(W, H), H * st.y);
}

// «AFFX Плашка»: заглавные, слова появляются по мере речи, плашка переезжает под текущее слово.
function drawAffxPlate(g, W, H, t, page, geo) {
  page = page || pageAt(t);
  if (!page) return;
  geo = geo || { s: W / 1080, cx: W / 2, cy: H * 1250 / 1920 };
  var s = geo.s, boxW = 920 * s, texts = page.words.map(function (w) { return upperUk(w.w.replace(/^~/, '')); });
  g.save();
  // Раскладка сразу для всей фразы: не больше 2 строк по 920 px, иначе шрифт меньше шагами по 2 px.
  var size = 82 * s, lines, space;
  for (;;) {
    g.font = fontStr(AFFX.heavy, size);
    space = g.measureText(' ').width * 1.1;
    lines = [];
    var line = [], lw = 0;
    texts.forEach(function (tx, i) {
      var w = g.measureText(tx).width;
      if (line.length && lw + space + w > boxW) { lines.push({ items: line, w: lw }); line = []; lw = 0; }
      lw += (line.length ? space : 0) + w;
      line.push({ text: tx, w: w, i: i });
    });
    lines.push({ items: line, w: lw });
    if ((lines.length <= 2 && lines.every(function (l) { return l.w <= boxW; })) || size <= 30 * s) break;
    size -= 2 * s;
  }
  // Поля плашки — от реальных границ ЗАГЛАВНЫХ (верх «Н» … базовая линия), замер тем же движком,
  // которым рисуем: у Benzin метрики строки сильно больше букв, иначе плашка съезжает вверх.
  var mH = g.measureText('Н'), capH = mH.actualBoundingBoxAscent || size * 0.72;
  // Базовая линия — как у браузера в строке line-height: 1 (так стоит текст в эталоне AffxCaptions.tsx):
  // по метрикам шрифта от верха строки; строки идут с шагом 1.32 × размер.
  var fA = mH.fontBoundingBoxAscent || size * 0.9, fD = mH.fontBoundingBoxDescent || size * 0.25;
  var baseInLine = (size - (fA + fD)) / 2 + fA;
  var lh = size * 1.32, top = geo.cy - lh * lines.length / 2, boxes = [];
  lines.forEach(function (l, li) {
    var x = geo.cx - l.w / 2, lineTop = top + li * lh, base = lineTop + baseInLine;
    l.items.forEach(function (it) { boxes[it.i] = { text: it.text, x: x, base: base, mid: lineTop + size / 2, w: it.w }; x += it.w + space; });
  });
  function appear(i) { return i === 0 ? page.start : page.words[i].s - LEAD; }
  var shown = 1;
  for (var i = 1; i < boxes.length; i++) if (t >= appear(i)) shown = i + 1;
  var act = shown - 1, padX = size * 0.22, padY = size * 0.16;
  function rectOf(b) { return [b.x - padX, b.base - capH - padY, b.x + b.w + padX, b.base + padY]; }
  var rect = rectOf(boxes[act]), sc = 1;
  if (act > 0) {
    var k = easeOutCubic((t - appear(act)) / 0.1), prev = rectOf(boxes[act - 1]);
    rect = rect.map(function (v, j) { return prev[j] + (v - prev[j]) * k; });
  } else {
    sc = 0.6 + 0.4 * easeOutBack((t - page.start) / 0.16);
  }
  var cx = (rect[0] + rect[2]) / 2, cy = (rect[1] + rect[3]) / 2, hw = (rect[2] - rect[0]) / 2 * sc, hh = (rect[3] - rect[1]) / 2 * sc;
  X.lastPlate = [cx - hw, cy - hh, cx + hw, cy + hh];          // для проверки по эталону
  g.fillStyle = AFFX.plate;
  roundRect(g, cx - hw, cy - hh, hw * 2, hh * 2, Math.min(size * 0.18 * sc, hh));
  g.fill();

  g.textBaseline = 'alphabetic'; g.fillStyle = '#fff';
  g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 20 * s; g.shadowOffsetY = 5 * s;
  for (i = 0; i < shown; i++) {
    var b = boxes[i], kk = (t - appear(i)) / 0.14, op = Math.max(0, Math.min(1, kk * 2.5));
    if (op <= 0) continue;
    var scl = 0.55 + 0.45 * easeOutBack(kk), dy = 16 * s * (1 - easeOutCubic(kk));
    var mx = b.x + b.w / 2, my = b.mid;                   // масштаб — от центра слова (как у блока слова в эталоне)
    g.save();
    g.globalAlpha = op;
    g.translate(mx, my + dy); g.scale(scl, scl);
    g.fillText(b.text, -b.w / 2, b.base - my);
    g.restore();
  }
  g.restore();
}

// «AFFX Микс»: мелкие белые слова + крупный цветной акцент, при желании зачёркнутый.
function drawAffxMix(g, W, H, t, page, geo) {
  page = page || pageAt(t);
  if (!page) return;
  geo = geo || { s: W / 1080, cx: W / 2, cy: H * 1340 / 1920 };   // блок y 1190…1490
  var s = geo.s, bw = 960 * s, gap = 20 * s, flags = mixFlags(page.words);
  g.save();
  g.textBaseline = 'alphabetic';
  var items = page.words.map(function (w, i) {
    var f = flags[i], text = f.accent ? upperUk(f.text) : f.text, font, size, L;
    if (f.accent) {
      g.font = fontStr(AFFX.heavy, 100 * s);
      size = Math.min(118 * s, bw / g.measureText(text).width * 100 * s * 0.98);
      font = AFFX.heavy; L = 1.02;
    } else { size = 56 * s; font = AFFX.body; L = 1.1; }
    g.font = fontStr(font, size);
    var m = g.measureText(text), asc = m.fontBoundingBoxAscent || size * 0.8, desc = m.fontBoundingBoxDescent || size * 0.2;
    var above = asc + (L * size - (asc + desc)) / 2;   // как строка CSS с line-height L, по базовой линии
    return { text: text, accent: f.accent, strike: f.strike, font: font, size: size, w: m.width, above: above, below: L * size - above, i: i };
  });
  var lines = [], line = [], lw = 0;
  items.forEach(function (it) {
    if (line.length && lw + gap + it.w > bw) { lines.push({ items: line, w: lw }); line = []; lw = 0; }
    lw += (line.length ? gap : 0) + it.w;
    line.push(it);
  });
  lines.push({ items: line, w: lw });
  var total = 0;
  lines.forEach(function (l) {
    l.above = Math.max.apply(null, l.items.map(function (x) { return x.above; }));
    l.below = Math.max.apply(null, l.items.map(function (x) { return x.below; }));
    total += l.above + l.below;
  });
  var y = geo.cy - total / 2;
  X.lastMix = [];                                                // для проверки по эталону
  lines.forEach(function (l) {
    var x = geo.cx - l.w / 2, base = y + l.above;
    l.items.forEach(function (it) {
      X.lastMix.push({ text: it.text, accent: it.accent, strike: it.strike, x: x, base: base, top: base - it.above, h: it.above + it.below, w: it.w, size: it.size, font: fontStr(it.font, it.size) });
      var w = page.words[it.i], appear = it.i === 0 ? page.start : w.s - LEAD;
      var k = (t - appear) / (it.accent ? 0.22 : 0.16), op = Math.max(0, Math.min(1, k * (it.accent ? 3 : 2.5)));
      if (op > 0) {                       // ещё не сказанное слово невидимо, но место под него оставлено
        g.save();
        g.globalAlpha = op;
        g.font = fontStr(it.font, it.size);
        g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 24 * s; g.shadowOffsetY = 6 * s;
        var top = base - it.above, hgt = it.above + it.below;
        if (it.accent) {
          var sc = 0.5 + 0.5 * easeOutBack(k), cx = x + it.w / 2, cy = top + hgt / 2;
          g.translate(cx, cy); g.scale(sc, sc); g.translate(-cx, -cy);
        } else {
          g.translate(0, 18 * s * (1 - easeOutCubic(k)));
        }
        g.fillStyle = it.accent ? AFFX.accent : '#fff';
        g.fillText(it.text, x, base);
        if (it.strike) {                  // «было — стало»: через 300 мс после слова его перечёркивает полоса
          var sk = easeOutCubic((t - (w.s + 0.3)) / 0.14);
          if (sk > 0) {
            var th = it.size * 0.13, sw = (it.w + 16 * s) * sk;
            g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 14 * s; g.shadowOffsetY = 4 * s;
            g.translate(x - 8 * s, top + hgt * 0.44);
            g.rotate(-2.5 * Math.PI / 180);
            g.fillStyle = AFFX.plate;
            roundRect(g, 0, 0, sw, th, Math.min(it.size * 0.07, th / 2, sw / 2));
            g.fill();
          }
        }
        g.restore();
      }
      x += it.w + gap;
    });
    y += l.above + l.below;
  });
  g.restore();
}
