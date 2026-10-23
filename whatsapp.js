// WhatsApp do lead — normalização, máscara e o modal "último passo".
//
// O número fica em user_metadata.whatsapp (Supabase Auth), só dígitos com DDI
// (ex.: 5535991747115). Quem cria conta pelo formulário informa no cadastro
// (login.html); quem entra direto pelo Google é perguntado no modal, antes de
// gerar o vídeo (wizard e dashboard chamam FluxWhatsApp.ensure).
(function () {
  // Aceita (DD) 9XXXX-XXXX, DD9XXXXXXXX ou com 55 na frente. Celular BR: DDD
  // 11-99 + 9 dígitos começando com 9 (fixo de 8 dígitos também passa).
  function normalize(value) {
    var d = String(value || '').replace(/\D/g, '');
    if (d.length >= 12 && d.indexOf('55') === 0) d = d.slice(2);
    if (d.length !== 10 && d.length !== 11) return null;
    var ddd = parseInt(d.slice(0, 2), 10);
    if (ddd < 11 || ddd > 99) return null;
    if (d.length === 11 && d.charAt(2) !== '9') return null;
    return '55' + d;
  }

  function format(digits) {
    var d = String(digits || '').replace(/\D/g, '');
    if (d.indexOf('55') === 0 && d.length > 11) d = d.slice(2);
    d = d.slice(0, 11);
    if (d.length <= 2) return d ? '(' + d : '';
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }

  function mask(input) {
    if (!input) return;
    input.setAttribute('inputmode', 'tel');
    input.setAttribute('autocomplete', 'tel-national');
    input.addEventListener('input', function () { input.value = format(input.value); });
  }

  function has(user) {
    return !!(user && user.user_metadata && user.user_metadata.whatsapp);
  }

  function save(client, digits) {
    return client.auth.updateUser({ data: { whatsapp: digits, whatsapp_at: new Date().toISOString() } });
  }

  var CSS = '' +
    '.fr-wa-overlay{position:fixed;inset:0;z-index:300;background:rgba(5,6,12,.78);display:flex;align-items:center;justify-content:center;padding:16px;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif}' +
    '.fr-wa-card{width:100%;max-width:400px;background:#11121c;border:1px solid #23253a;border-radius:20px;padding:28px 24px;color:#fff;box-shadow:0 30px 60px -20px rgba(0,0,0,.7)}' +
    '.fr-wa-card h2{margin:0 0 8px;font-size:20px;line-height:1.25}' +
    '.fr-wa-card p{margin:0 0 16px;font-size:14px;line-height:1.55;color:#a8a8b8}' +
    '.fr-wa-card label{display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:#e4e4e7}' +
    '.fr-wa-card input{width:100%;box-sizing:border-box;background:#0c0d16;border:1px solid #2c2f47;border-radius:12px;padding:13px 14px;font-size:16px;color:#fff;outline:none}' +
    '.fr-wa-card input:focus{border-color:#4F6BFF;box-shadow:0 0 0 3px rgba(79,107,255,.25)}' +
    '.fr-wa-err{min-height:18px;margin:8px 0 0;font-size:13px;color:#fca5a5}' +
    '.fr-wa-card button{width:100%;margin-top:10px;border:0;border-radius:999px;padding:14px;font-size:15px;font-weight:700;color:#fff;cursor:pointer;' +
      'background-image:linear-gradient(90deg,#4F6BFF 0%,#6A5CFF 50%,#20D9FF 100%)}' +
    '.fr-wa-card button:disabled{opacity:.55;cursor:wait}' +
    '.fr-wa-note{margin:12px 0 0;font-size:11.5px;line-height:1.5;color:#7d7d92;text-align:center}';

  var openPromise = null;

  // Garante que o usuário tem WhatsApp salvo. Resolve true quando tem (já tinha
  // ou acabou de informar). Sem opção de pular: é o "último passo".
  function ensure(client, user) {
    if (openPromise) return openPromise;
    openPromise = new Promise(function (resolve) {
      // Confere o dado mais novo no servidor (a sessão em memória pode estar velha).
      var fresh = Promise.resolve(client.auth.getUser()).then(function (r) { return (r && r.data && r.data.user) || user; }, function () { return user; });
      fresh.then(function (u) {
        if (has(u)) { openPromise = null; resolve(true); return; }
        show(client, u || user, function () { openPromise = null; resolve(true); });
      });
    });
    return openPromise;
  }

  function show(client, user, done) {
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);

    var ov = document.createElement('div');
    ov.className = 'fr-wa-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = '<form class="fr-wa-card" novalidate>' +
      '<h2>Último passo para gerar seu vídeo</h2>' +
      '<p>Qual é o seu WhatsApp de contato? Usamos só para suporte e avisos da sua conta.</p>' +
      '<label for="fr-wa-input">WhatsApp (com DDD)</label>' +
      '<input id="fr-wa-input" type="tel" placeholder="(35) 99999-9999" maxlength="16" />' +
      '<div class="fr-wa-err" id="fr-wa-err" aria-live="polite"></div>' +
      '<button type="submit">Continuar</button>' +
      '<div class="fr-wa-note">Ao continuar, você aceita receber contato da FluxReel por WhatsApp.</div>' +
      '</form>';
    document.body.appendChild(ov);

    var input = ov.querySelector('#fr-wa-input');
    var err = ov.querySelector('#fr-wa-err');
    var btn = ov.querySelector('button');
    mask(input);
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 50);

    ov.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var digits = normalize(input.value);
      if (!digits) { err.textContent = 'Digite um WhatsApp válido, com DDD. Ex.: (35) 99999-9999'; return; }
      err.textContent = '';
      btn.disabled = true;
      var label = btn.textContent;
      btn.textContent = 'Salvando…';
      save(client, digits).then(function (r) {
        if (r && r.error) throw r.error;
        if (user && user.user_metadata) user.user_metadata.whatsapp = digits;
        document.body.removeChild(ov);
        done();
      }, function (ex) { throw ex; }).then(null, function (ex) {
        console.error('[FluxReel] Não foi possível salvar o WhatsApp:', ex);
        err.textContent = 'Não foi possível salvar agora. Tente de novo.';
        btn.disabled = false;
        btn.textContent = label;
      });
    });
  }

  window.FluxWhatsApp = { normalize: normalize, format: format, mask: mask, has: has, ensure: ensure };
})();