// Outils communs a la boutique et a l'espace Gestion.
(function () {
  'use strict';
  var C = window.BOUTIQUE_CONFIG;
  var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY);
  var CUR = 'FCFA';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return Number(n).toLocaleString('fr-FR') + ' ' + CUR; }
  function setCurrency(c) { CUR = c || 'FCFA'; }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 3) | 8).toString(16);
    });
  }

  // Reduit une photo (cote max en pixels, qualite 0 a 1) et renvoie un Blob JPEG.
  function shrink(file, max, q) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var im = new Image();
      im.onload = function () {
        var k = Math.min(1, max / Math.max(im.width, im.height));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(im.width * k));
        c.height = Math.max(1, Math.round(im.height * k));
        var x = c.getContext('2d');
        x.fillStyle = '#fff';
        x.fillRect(0, 0, c.width, c.height);
        x.drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('image')); }, 'image/jpeg', q);
      };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image')); };
      im.src = url;
    });
  }

  var tt;
  function toast(m) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = m;
    t.hidden = false;
    clearTimeout(tt);
    tt = setTimeout(function () { t.hidden = true; }, 2800);
  }

  function publicUrl(path) {
    return path ? sb.storage.from('products').getPublicUrl(path).data.publicUrl : '';
  }

  // Tailles d'un article, dans l'ordre choisi. "unique" = article sans taille.
  function sizesOf(p) {
    return (p.product_sizes || []).slice().sort(function (a, b) {
      return (a.sort - b.sort) || a.size.localeCompare(b.size);
    });
  }
  function hasSizes(p) {
    var s = sizesOf(p);
    return !(s.length === 1 && s[0].size === 'unique');
  }
  function totalStock(p) {
    return (p.product_sizes || []).reduce(function (t, s) { return t + s.stock; }, 0);
  }

  window.B = { sb: sb, esc: esc, money: money, setCurrency: setCurrency, uuid: uuid, shrink: shrink,
    toast: toast, publicUrl: publicUrl, sizesOf: sizesOf, hasSizes: hasSizes, totalStock: totalStock };
})();
