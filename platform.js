// Reelista — платформа: всё, что зависит от того, ГДЕ запущено приложение.
//
//   в браузере (сайт)            → веб-реализации, как раньше;
//   в нативной оболочке Capacitor → нативный модуль ReelistaNative (AVFoundation на iPhone,
//                                    Media3 на Android), если он умеет нужное действие.
//
// Остальной код спрашивает Platform, а не проверяет браузер сам — так нативные модули
// встают на место без переделки экранов и движка.
//
// Что должен уметь нативный модуль (Capacitor-плагин «ReelistaNative»), все методы — Promise:
//   cutVideo({ segments: [{ path, start, end }] })
//       → { path, url }   склеенные куски одним файлом H.264 + AAC, без титров, размер — по первому
//                         исходнику (длинная сторона ≤ 1920), поворот учтён;
//                         url — адрес для веб-части (Capacitor.convertFileSrc(path)).
//       path исходника — clip.path: его заполняет нативный выбор/запись ролика (шаг 3–4 плана);
//       пока у клипа нет path, сборка идёт целиком в вебе.
//   saveToPhotos({ path })            → { saved: true }   сохранить ролик в «Фото»/«Галерею».
// Любого метода может не быть — тогда работает веб-путь.
var Platform = (function () {
  var cap = window.Capacitor;
  var native = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  var plugin = native && cap.Plugins ? cap.Plugins.ReelistaNative : null;

  function can(method) { return !!(plugin && typeof plugin[method] === 'function'); }

  // Веб: «Поделиться» → «Сохранить видео» (на iPhone попадает в «Фото»), иначе скачивание.
  function saveWeb(blob, name, url) {
    var file = new File([blob], name, { type: blob.type || 'video/mp4' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file] }).then(function () { return 'shared'; }, function (e) {
        if (e && e.name === 'AbortError') return 'cancelled';
        download(url, name);
        return 'downloaded';
      });
    }
    download(url, name);
    return Promise.resolve('downloaded');
  }
  function download(url, name) {
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  return {
    name: native ? cap.getPlatform() : 'web',
    native: native,
    can: can,

    // Нарезка исходников в один файл без титров → { file, path }. null — нативной нарезки нет,
    // сборка идёт целиком в вебе. Куски — по времени внутри своего исходника (секунды).
    cutVideo: can('cutVideo') ? function (segments) {
      return plugin.cutVideo({ segments: segments }).then(function (r) {
        return fetch(r.url).then(function (x) { return x.blob(); }).then(function (b) {
          return { file: new File([b], 'cut.mp4', { type: 'video/mp4' }), path: r.path };
        });
      });
    } : null,

    // Сохранение готового ролика. result: 'saved' | 'shared' | 'downloaded' | 'cancelled'.
    saveVideo: function (blob, name, url, nativePath) {
      if (nativePath && can('saveToPhotos')) {
        return plugin.saveToPhotos({ path: nativePath }).then(function () { return 'saved'; });
      }
      return saveWeb(blob, name, url);
    }
  };
})();
