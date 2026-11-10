// Reelista — движок: Общие мелочи: форматирование, плавности, шрифты, скруглённый прямоугольник.
// Чистая логика без экранов и кнопок. Вынесено из index.html (10.11.2026), чтобы рядом
// с веб-версией встали нативные модули оболочки (Capacitor) — см. platform.js.
// Классический скрипт: функции глобальные, данные берут из общего состояния S/X при вызове.

function fmt(t) {
  t = Math.max(0, t || 0);
  var m = Math.floor(t / 60), s = Math.floor(t % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function plural(n, one, few, many) {
  var a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

function errText(e) {
  if (!e) return 'неизвестная ошибка';
  return ((e.name && e.name !== 'Error' ? e.name : '') + (e.message ? (e.name && e.name !== 'Error' ? ': ' : '') + e.message : '')) || String(e);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function easeOutCubic(x) { x = Math.max(0, Math.min(1, x)); return 1 - Math.pow(1 - x, 3); }

function easeOutBack(x) { x = Math.max(0, Math.min(1, x)); var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }

function fontStr(f, size) { return f.weight + ' ' + size + 'px "' + f.family + '", sans-serif'; }

function upperUk(s) { return s.toLocaleUpperCase('uk'); }

function letterCount(s) { return s.replace(/[^\p{L}\p{N}]/gu, '').length; }

function normKey(s) { return s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]/gu, ''); }
