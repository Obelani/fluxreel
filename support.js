// Suporte por WhatsApp — número único do app + barra fixa no mobile.
//
// Pra trocar o número do suporte, mexa SÓ aqui (PHONE) e no link estático do
// botão em dashboard.html (aba "Fale Conosco", id btn-whatsapp-contact).
(function () {
  var PHONE = '5535991747115'; // (35) 99174-7115
  var DEFAULT_MSG = 'Olá! Estou com dúvida sobre a FluxReel.';

  function url(msg) {
    return 'https://wa.me/' + PHONE + '?text=' + encodeURIComponent(msg || DEFAULT_MSG);
  }
  // A barra do mobile só vale pra quem ainda não é assinante (assinante tem o
  // menu Fale Conosco no dashboard): na landing aparece sempre; no wizard a
  // página define window.FLUX_SUPPORT_BAR = 'manual' antes de carregar este
  // arquivo e chama FluxSupport.showBar() só se NÃO houver assinatura ativa.
  var manual = window.FLUX_SUPPORT_BAR === 'manual';

  var css = '' +
    '.fr-support-bar{display:none}' +
    '@media (max-width:768px){' +
      '.fr-support-bar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:90;align-items:center;justify-content:space-between;gap:12px;' +
        'padding:10px 14px calc(10px + env(safe-area-inset-bottom, 0px));background:rgba(10,12,24,.97);border-top:1px solid rgba(255,255,255,.12);' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;box-shadow:0 -8px 24px -12px rgba(0,0,0,.6)}' +
      '.fr-support-bar span{font-size:13px;line-height:1.3;color:#d4d4d8}' +
      '.fr-support-bar a{flex-shrink:0;display:inline-flex;align-items:center;gap:6px;background:#25D366;color:#06210f;font-weight:700;font-size:13px;' +
        'text-decoration:none;border-radius:999px;padding:9px 16px}' +
      'body.fr-has-support-bar{padding-bottom:calc(64px + env(safe-area-inset-bottom, 0px))}' +
      /* o aviso (toast) das páginas fica acima da barra */
      'body.fr-has-support-bar .toast{bottom:84px !important}' +
    '}';

  function mount() {
    if (document.getElementById('fr-support-bar') || !document.body) return;
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    var bar = document.createElement('div');
    bar.id = 'fr-support-bar';
    bar.className = 'fr-support-bar';
    bar.innerHTML = '<span>Ficou com dúvida? Chame no WhatsApp</span>' +
      '<a href="' + url() + '" target="_blank" rel="noopener noreferrer" aria-label="Chamar o suporte no WhatsApp">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.6-.91-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.87 1.22 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.04 2C6.5 2 2 6.5 2 12.04c0 1.77.46 3.5 1.34 5.02L2 22l5.07-1.33a10 10 0 004.97 1.32C17.58 22 22 17.5 22 11.96 22 6.5 17.58 2 12.04 2z"/></svg>' +
      'WhatsApp</a>';
    document.body.appendChild(bar);
    document.body.classList.add('fr-has-support-bar');
  }

  function showBar() {
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
  }
  function hideBar() {
    var bar = document.getElementById('fr-support-bar');
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    if (document.body) document.body.classList.remove('fr-has-support-bar');
  }

  window.FluxSupport = { phone: PHONE, url: url, showBar: showBar, hideBar: hideBar };

  if (!manual) showBar();
})();