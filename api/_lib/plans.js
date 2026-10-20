// Espelha os planos definidos em create-series.html (var PLANS) — se mudar
// preço/frequência lá, revisar aqui também (e os Prices correspondentes na Stripe).

// Créditos concedidos por mês de assinatura, por plano — reflete a frequência
// já anunciada em cada plano no wizard (Inicial ~3/semana, Diário ~1/dia, Pro ~2/dia).
const PLAN_MONTHLY_CREDITS = {
  inicial: 12,
  diario: 30,
  pro: 60,
};

const PRICE_ENV_MAP = {
  'inicial:monthly': 'STRIPE_PRICE_INICIAL_MONTHLY',
  'inicial:annual': 'STRIPE_PRICE_INICIAL_ANNUAL',
  'diario:monthly': 'STRIPE_PRICE_DIARIO_MONTHLY',
  'diario:annual': 'STRIPE_PRICE_DIARIO_ANNUAL',
  'pro:monthly': 'STRIPE_PRICE_PRO_MONTHLY',
  'pro:annual': 'STRIPE_PRICE_PRO_ANNUAL',
};

function getPriceId(planId, billingCycle) {
  const envName = PRICE_ENV_MAP[planId + ':' + billingCycle];
  if (!envName) return null;
  return process.env[envName] || null;
}

// Pacote fechado por ciclo: mensal = 1x os créditos do mês; anual = 12x
// (o ciclo de cobrança anual concede de uma vez o total do ano), multiplicado
// pela quantidade de séries simultâneas escolhida no paywall.
function getCreditsForCycle(planId, billingCycle, quantity) {
  const monthly = PLAN_MONTHLY_CREDITS[planId];
  if (!monthly) return 0;
  const multiplier = billingCycle === 'annual' ? 12 : 1;
  return monthly * multiplier * (quantity || 1);
}

// Ofertas do produto "Fluxreel" na Cakto (id da oferta = final do link
// https://pay.cakto.com.br/<id>). O webhook da Cakto (api/cakto-webhook.js)
// usa isso pra saber qual plano/ciclo foi comprado — se criar/trocar uma
// oferta lá, atualizar aqui e nos dois HTMLs (CAKTO_OFFERS em
// create-series.html e dashboard.html).
const CAKTO_OFFERS = {
  iskm4yt: { planId: 'inicial', billingCycle: 'monthly' },
  madd2ag: { planId: 'inicial', billingCycle: 'annual' },
  zzzcexo: { planId: 'diario', billingCycle: 'monthly' },
  '382wt8b': { planId: 'diario', billingCycle: 'annual' },
  '3f8hyrc': { planId: 'pro', billingCycle: 'monthly' },
  fabfdtn: { planId: 'pro', billingCycle: 'annual' },
};

function getCaktoOffer(offerId) {
  return (offerId && CAKTO_OFFERS[offerId]) || null;
}

module.exports = { PLAN_MONTHLY_CREDITS, CAKTO_OFFERS, getCaktoOffer, getPriceId, getCreditsForCycle };
