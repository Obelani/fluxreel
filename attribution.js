// Atribuição de origem (UTMs do Facebook etc.).
//
// Os anúncios mandam o visitante pra landing com ?utm_source=...&utm_campaign=...
// mas o checkout fica em OUTRO domínio (pay.cakto.com.br) e o caminho até lá
// passa por login e wizard — então a URL perde os parâmetros no meio. Aqui
// guardamos tudo no aparelho assim que o visitante chega, e o checkout
// (goToCaktoCheckout em create-series.html / dashboard.html) devolve os
// parâmetros no link pra Cakto registrar a origem de cada venda.
//
// Última origem vale (um clique novo de anúncio substitui o anterior; visita
// direta, sem parâmetros, não apaga nada). Validade: 30 dias. Também é gravada
// no cadastro do usuário (user_metadata.attribution) pra sobreviver a e-mail de
// confirmação aberto em outro navegador/aparelho.
(function () {
  var KEY = 'fr_attr_v1';
  var TTL_MS = 30 * 24 * 60 * 60 * 1000;
  // Os 7 primeiros são os que a Cakto lê no checkout (src, sck e utm_*);
  // fbclid ajuda o pixel do checkout a casar a venda com o anúncio.
  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'src', 'sck', 'fbclid'];

  function clean(v) {
    return String(v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255);
  }

  function readUrl() {
    var out = {}, found = false;
    try {
      var p = new URLSearchParams(window.location.search);
      KEYS.forEach(function (k) {
        var v = p.get(k);
        // O tracker avançado reescreve utm_term na URL com "stl_<sessão>" (marcador
        // dele): isso não é origem de anúncio, então não guardamos.
        if (v && clean(v) && clean(v).indexOf('stl_') !== 0) { out[k] = clean(v); found = true; }
      });
    } catch (e) { /* navegador sem URLSearchParams: ignora */ }
    return found ? out : null;
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.params || (Date.now() - o.ts) > TTL_MS) return null;
      return o.params;
    } catch (e) { return null; }
  }

  function save(params) {
    try { window.localStorage.setItem(KEY, JSON.stringify({ params: params, ts: Date.now(), landing: window.location.pathname })); } catch (e) { /* storage bloqueado */ }
  }

  var fromUrl = readUrl();
  if (fromUrl) save(fromUrl);

  function sanitize(obj) {
    var out = {};
    if (!obj) return out;
    KEYS.forEach(function (k) { if (obj[k]) out[k] = clean(obj[k]); });
    return out;
  }

  window.FluxAttribution = {
    // Origem guardada neste aparelho (ou null).
    get: function () { return load(); },

    // Origem efetiva pro checkout: a deste aparelho, senão a gravada no
    // cadastro do usuário (cobre o caso de confirmar o e-mail em outro lugar).
    resolve: function (user) {
      var local = load();
      if (local) return sanitize(local);
      var meta = user && user.user_metadata && user.user_metadata.attribution;
      return sanitize(meta);
    },

    // Acrescenta os parâmetros (já codificados) no final de uma URL que já tem "?".
    toQuery: function (params) {
      var s = '';
      Object.keys(params || {}).forEach(function (k) { s += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); });
      return s;
    },

    // Grava a origem no cadastro (uma vez, só se ainda não existir).
    persistToUser: function (client, user) {
      try {
        var local = load();
        if (!client || !user || !local) return;
        if (user.user_metadata && user.user_metadata.attribution) return;
        client.auth.updateUser({ data: { attribution: sanitize(local) } }).then(function () {}, function () {});
      } catch (e) { /* nunca atrapalha o app */ }
    }
  };
})();