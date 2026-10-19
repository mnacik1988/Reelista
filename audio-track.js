// Достаём из видео (MP4 / MOV) ТОЛЬКО звуковую дорожку AAC и упаковываем её в поток ADTS,
// который Safari и Chrome умеют декодировать (decodeAudioData).
//
// Зачем: раньше весь файл читался в память ради звука. Минута 4K с iPhone — 300–400 МБ,
// Safari на таком падал («Не получилось прочитать звук»). Здесь читаются только заголовки
// контейнера (moov, сотни КБ) и куски со звуком (~1–2 МБ на минуту), сколько бы ни весило видео.
//
// Если файл не MP4/MOV, звук не AAC или контейнер «нарезанный» (fragmented MP4, как пишет
// MediaRecorder) — бросаем ошибку, и вызывающий код идёт старым путём (весь файл целиком).
(function (root) {
  var FREQS = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

  function read(blob, start, len) {
    return blob.slice(start, start + len).arrayBuffer().then(function (b) { return new DataView(b); });
  }
  function type4(dv, p) { return String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3)); }
  function u64(dv, p) { return dv.getUint32(p) * 4294967296 + dv.getUint32(p + 4); }

  // Верхний уровень файла: идём по заголовкам блоков (16 байт), не читая содержимое, пока не найдём moov.
  function findMoov(blob) {
    function step(off) {
      if (off + 8 > blob.size) return Promise.reject(new Error('нет блока moov'));
      return read(blob, off, 16).then(function (dv) {
        var size = dv.getUint32(0), type = type4(dv, 4);
        if (size === 1) size = u64(dv, 8);
        else if (size === 0) size = blob.size - off;
        if (size < 8) throw new Error('битый контейнер');
        if (type === 'moov') return { off: off, size: size };
        return step(off + size);
      });
    }
    return step(0);
  }

  function children(dv, start, end) {
    var out = [], p = start;
    while (p + 8 <= end) {
      var size = dv.getUint32(p), hdr = 8;
      if (size === 1) { size = u64(dv, p + 8); hdr = 16; } else if (size === 0) size = end - p;
      if (size < hdr || p + size > end) break;
      out.push({ type: type4(dv, p + 4), start: p + hdr, end: p + size });
      p += size;
    }
    return out;
  }
  function child(dv, box, type) {
    var c = children(dv, box.start, box.end);
    for (var i = 0; i < c.length; i++) if (c[i].type === type) return c[i];
    return null;
  }
  function path(dv, box, types) {
    for (var i = 0; i < types.length && box; i++) box = child(dv, box, types[i]);
    return box;
  }

  // Длина дескриптора в esds: до 4 байт, старший бит — «продолжение».
  function descLen(dv, p) {
    var len = 0, n = 0, b;
    do { b = dv.getUint8(p + n); len = (len << 7) | (b & 0x7f); n++; } while ((b & 0x80) && n < 4);
    return { len: len, n: n };
  }

  // esds → AudioSpecificConfig (первые 2 байта: тип AAC, частота, каналы).
  function parseEsds(dv, box) {
    var p = box.start + 4;                                      // version + flags
    if (dv.getUint8(p) !== 0x03) throw new Error('esds без ES_Descriptor');
    var l = descLen(dv, p + 1); p += 1 + l.n;
    var flags = dv.getUint8(p + 2); p += 3;
    if (flags & 0x80) p += 2;
    if (flags & 0x40) p += 1 + dv.getUint8(p);
    if (flags & 0x20) p += 2;
    if (dv.getUint8(p) !== 0x04) throw new Error('esds без DecoderConfig');
    l = descLen(dv, p + 1); p += 1 + l.n;
    var oti = dv.getUint8(p); p += 13;
    if (oti !== 0x40 && oti !== 0x66 && oti !== 0x67 && oti !== 0x68) throw new Error('звук не AAC');
    if (dv.getUint8(p) !== 0x05) throw new Error('esds без AudioSpecificConfig');
    l = descLen(dv, p + 1); p += 1 + l.n;
    var b0 = dv.getUint8(p), b1 = dv.getUint8(p + 1);
    var aot = b0 >> 3, fi = ((b0 & 7) << 1) | (b1 >> 7), ch = (b1 >> 3) & 15;
    if (fi === 15) {                                             // частота записана явно
      var hz = ((b1 & 0x7f) << 17) | (dv.getUint8(p + 2) << 9) | (dv.getUint8(p + 3) << 1) | (dv.getUint8(p + 4) >> 7);
      fi = FREQS.indexOf(hz);
      ch = (dv.getUint8(p + 4) >> 3) & 15;
    }
    if (aot < 1 || aot > 4 || fi < 0 || ch < 1 || ch > 7) throw new Error('неподдерживаемый AAC (' + aot + '/' + fi + '/' + ch + ')');
    return { profile: aot - 1, fi: fi, ch: ch };
  }

  // Ищем esds внутри описания mp4a: в MP4 он лежит сразу, в QuickTime .mov — внутри блока wave.
  function findEsds(dv, entry) {
    var ver = dv.getUint16(entry.start + 8);
    var skip = ver === 1 ? 44 : ver === 2 ? 64 : 28;
    var box = { start: entry.start + skip, end: entry.end };
    var e = child(dv, box, 'esds');
    if (e) return e;
    var wave = child(dv, box, 'wave');
    return wave ? child(dv, wave, 'esds') : null;
  }

  function soundTrack(dv, moov) {
    var traks = children(dv, moov.start, moov.end).filter(function (b) { return b.type === 'trak'; });
    for (var i = 0; i < traks.length; i++) {
      var hdlr = path(dv, traks[i], ['mdia', 'hdlr']);
      if (hdlr && type4(dv, hdlr.start + 8) === 'soun') return traks[i];
    }
    return null;
  }

  // Таблицы stbl → смещение и размер каждого звукового фрагмента, сгруппированные по «кускам» (chunk).
  function sampleChunks(dv, stbl) {
    var stsz = child(dv, stbl, 'stsz'), stsc = child(dv, stbl, 'stsc');
    var stco = child(dv, stbl, 'stco'), co64 = child(dv, stbl, 'co64');
    if (!stsz || !stsc || !(stco || co64)) throw new Error('нет таблиц фрагментов');
    var fixed = dv.getUint32(stsz.start + 4), count = dv.getUint32(stsz.start + 8);
    if (!count) throw new Error('дорожка пустая (fragmented MP4?)');
    var sizes = new Array(count);
    for (var i = 0; i < count; i++) sizes[i] = fixed || dv.getUint32(stsz.start + 12 + i * 4);
    var co = stco || co64, nChunks = dv.getUint32(co.start + 4), offs = new Array(nChunks);
    for (i = 0; i < nChunks; i++) offs[i] = co64 ? u64(dv, co.start + 8 + i * 8) : dv.getUint32(co.start + 8 + i * 4);
    var nRuns = dv.getUint32(stsc.start + 4), runs = [];
    for (i = 0; i < nRuns; i++) {
      var q = stsc.start + 8 + i * 12;
      runs.push({ first: dv.getUint32(q), per: dv.getUint32(q + 4) });
    }
    var chunks = [], s = 0, r = 0;
    for (var c = 1; c <= nChunks && s < count; c++) {
      while (r + 1 < runs.length && runs[r + 1].first <= c) r++;
      var n = Math.min(runs[r].per, count - s), list = sizes.slice(s, s + n);
      chunks.push({ off: offs[c - 1], sizes: list, bytes: list.reduce(function (a, b) { return a + b; }, 0) });
      s += n;
    }
    return chunks;
  }

  // Сколько секунд в начале дорожки — «разгон» кодировщика AAC, который плеер пропускает (edit list).
  function primingSeconds(dv, trak) {
    var mdhd = path(dv, trak, ['mdia', 'mdhd']), elst = path(dv, trak, ['edts', 'elst']);
    if (!mdhd || !elst) return 0;
    var v = dv.getUint8(mdhd.start), scale = dv.getUint32(mdhd.start + (v === 1 ? 20 : 12));
    var ev = dv.getUint8(elst.start), n = dv.getUint32(elst.start + 4), p = elst.start + 8;
    for (var i = 0; i < n; i++) {
      var mt = ev === 1 ? (dv.getInt32(p + 8) < 0 ? -1 : u64(dv, p + 8)) : dv.getInt32(p + 4);
      if (mt >= 0) return scale ? mt / scale : 0;               // первая непустая правка
      p += ev === 1 ? 20 : 12;
    }
    return 0;
  }

  function adtsHeader(out, p, cfg, len) {
    out[p] = 0xFF; out[p + 1] = 0xF1;
    out[p + 2] = (cfg.profile << 6) | (cfg.fi << 2) | (cfg.ch >> 2);
    out[p + 3] = ((cfg.ch & 3) << 6) | (len >> 11);
    out[p + 4] = (len >> 3) & 0xFF;
    out[p + 5] = ((len & 7) << 5) | 0x1F;
    out[p + 6] = 0xFC;
  }

  // → { adts: ArrayBuffer, rate, channels, priming (сек), samples, bytesRead }
  function extract(blob) {
    return findMoov(blob).then(function (m) {
      if (m.size > 64 * 1048576) throw new Error('слишком большой moov');
      return read(blob, m.off, m.size);
    }).then(function (dv) {
      var moov = children(dv, 0, dv.byteLength)[0];
      var trak = moov && soundTrack(dv, moov);
      if (!trak) { var e = new Error('В ролике нет звуковой дорожки'); e.noAudio = true; throw e; }
      var stbl = path(dv, trak, ['mdia', 'minf', 'stbl']), stsd = stbl && child(dv, stbl, 'stsd');
      if (!stsd) throw new Error('нет описания звука');
      var entry = children(dv, stsd.start + 8, stsd.end)[0];
      if (!entry || entry.type !== 'mp4a') throw new Error('звук не AAC (' + (entry ? entry.type : '?') + ')');
      var esds = findEsds(dv, entry);
      if (!esds) throw new Error('нет esds');
      var cfg = parseEsds(dv, esds), chunks = sampleChunks(dv, stbl), priming = primingSeconds(dv, trak);
      var total = chunks.reduce(function (a, c) { return a + c.bytes + c.sizes.length * 7; }, 0);
      var out = new Uint8Array(total), pos = 0, readBytes = 0, i = 0;
      // Куски читаем по очереди, но пачками по 8 — быстро и без лишней памяти.
      function batch() {
        if (i >= chunks.length) return Promise.resolve();
        var part = chunks.slice(i, i + 8); i += 8;
        return Promise.all(part.map(function (c) { return read(blob, c.off, c.bytes); })).then(function (dvs) {
          dvs.forEach(function (d, k) {
            var src = new Uint8Array(d.buffer, d.byteOffset, d.byteLength), q = 0;
            readBytes += d.byteLength;
            part[k].sizes.forEach(function (sz) {
              adtsHeader(out, pos, cfg, sz + 7);
              out.set(src.subarray(q, q + sz), pos + 7);
              pos += sz + 7; q += sz;
            });
          });
          return batch();
        });
      }
      return batch().then(function () {
        return { adts: out.buffer, rate: FREQS[cfg.fi], channels: cfg.ch, priming: priming,
                 samples: chunks.reduce(function (a, c) { return a + c.sizes.length; }, 0), bytesRead: readBytes };
      });
    });
  }

  root.ReelistaAudio = { extract: extract };
})(typeof window !== 'undefined' ? window : globalThis);
