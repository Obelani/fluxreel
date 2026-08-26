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

module.exports = { PLAN_MONTHLY_CREDITS, getPriceId, getCreditsForCycle };
