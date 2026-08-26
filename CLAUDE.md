# FluxReel

Clone rebrandizado do site ViralIA (ferramenta de geração de vídeos virais por IA). Front estático — HTML/CSS/JS vanilla, sem framework, sem build step. Hospedado na Vercel, deploy automático a cada push no GitHub. Desde a adição do backend de geração de vídeos, o projeto também tem `/api` (Vercel Functions em Node) — ver seção **Backend** abaixo.

## Arquivos (front)

- `index.html` — landing page pública. Hero, seção "estilos" (marquee com vídeos), carrossel "A gente entrega views" (imagens estáticas), monetização, depoimentos, "como funciona", FAQ. Botão "Entrar com Google" no cabeçalho.
- `login.html` — tela de login/cadastro (abas Entrar/Criar conta), botão Google + formulário e-mail/senha. Lê `?mode=signup` (abre direto na aba de cadastro) e `?next=` (pra onde voltar depois de logar).
- `create-series.html` — assistente de criação de série em 7 etapas (Nicho → Idioma e voz → Música de fundo → Estilo visual → Estilo de legenda → Efeitos → Detalhes da série) + popup de planos/pagamento no final. O paywall já chama `/api/create-series` e `/api/create-checkout-session` de verdade (Stripe Checkout); a geração do vídeo em si (pipeline de IA) ainda está sendo construída — ver `Próximos passos`. Exige login: redireciona pra `login.html` se não houver sessão (via `requireAuth()`).
- `auth.js` — toda a lógica de autenticação via Supabase (Google OAuth + e-mail/senha) e a proteção de páginas (`requireAuth()`). **Contém chaves reais** (Project URL e anon key do Supabase, nas 2 primeiras linhas com valor). Não são secretas (a `service_role key` que seria, e essa nunca é usada aqui), mas são configuração de produção — nunca sobrescreva essas duas linhas com placeholder.
- `logo-icon.webp` — ícone da marca.
- `LEIA-ME.txt` — lista de assets (imagens/vídeos/áudios) que ainda faltam subir pro site funcionar 100% (com os caminhos exatos esperados pelo código).

## Backend (`/api`, Vercel Functions)

Adicionado para conectar pagamento (Stripe) e a geração real dos vídeos. Não muda as convenções do front (continua sem build step, sem framework) — é uma pasta `/api` à parte, com seu próprio `package.json` na raiz (dependências Node: `stripe`, `@supabase/supabase-js`, mais as que forem entrando no pipeline de geração).

- `api/_lib/supabaseAdmin.js` — client Supabase server-side, usa a `service_role key` (nunca exposta ao front).
- `api/_lib/auth.js` — `getAuthenticatedUser(req)`, valida o token Bearer (sessão Supabase) mandado pelo front e resolve o usuário. Toda function autenticada usa isso — nunca confiar em `user_id` vindo do client.
- `api/_lib/plans.js` — espelha os 3 planos definidos em `create-series.html` (`var PLANS`): mapeia plano+ciclo pro Price ID da Stripe e calcula quantos créditos cada ciclo de assinatura libera.
- `api/create-series.js` — salva a config do wizard (tabela `series`) assim que a etapa 7 termina, antes do paywall.
- `api/create-checkout-session.js` — cria a Stripe Checkout Session (assinatura) pro plano escolhido no paywall.
- `api/stripe-webhook.js` — recebe os eventos da Stripe, confirma pagamento e credita a conta do usuário (via a função `grant_subscription_credits` no Postgres — idempotente).
- `supabase/schema.sql` — schema completo (tabelas `series`, `subscriptions`, `credit_balances`, `credit_ledger`, `videos` + RLS + funções de crédito). Aplicado manualmente no SQL Editor do Supabase; não há CLI/migrations configurado.
- `.env.example` — lista todas as variáveis de ambiente que o backend precisa (Stripe, Supabase, e as do pipeline de IA que ainda vão entrar). Copiar os valores reais só pra Vercel (Settings > Environment Variables), nunca commitar um `.env` de verdade.

Créditos: 1 crédito = 1 vídeo. Pacote fechado por ciclo de cobrança (não recarrega diariamente) — fórmula e valores em `api/_lib/plans.js`.

## Marca

```css
--brand-blue: #4F6BFF;
--brand-cyan: #20D9FF;
--brand-dark: #080B18;
```
Gradiente padrão (botões, destaques, textos em destaque): `linear-gradient(90deg, var(--brand-blue) 0%, #6A5CFF 45-50%, var(--brand-cyan) 100%)`

## Convenções

- CSS 100% próprio, sem Tailwind nem outro framework — variáveis CSS (`:root`) para os tokens de marca, classes utilitárias próprias (`.btn`, `.btn-gradient`, `.field`, etc.).
- JS vanilla, estilo `function`/`var` (compatibilidade ampla), sem bibliotecas além do `supabase-js` (carregado via CDN jsdelivr).
- Todo texto de interface em português (pt-BR).
- Cada página HTML é autocontida — CSS e JS inline no próprio arquivo, sem arquivos `.css`/`.js` separados (exceto `auth.js`, que é compartilhado entre as páginas).
- Sem build step: qualquer alteração é direto no HTML/CSS/JS final, pronta pra deploy.

## Autenticação (Supabase)

- Login com Google e e-mail/senha via Supabase Auth.
- Google Cloud Console: projeto "fluxreel", OAuth Client tipo "Aplicativo da Web", origem autorizada = domínio da Vercel.
- Supabase → Authentication → URL Configuration: Site URL e Redirect URLs devem cobrir o domínio da Vercel com curinga (`https://dominio.vercel.app/**`), senão o login quebra sempre que a página de destino muda.
- `REDIRECT_AFTER_LOGIN` em `auth.js` aponta pra `/create-series.html`.
- `requireAuth()` (em `auth.js`) é a função que protege páginas — chame no topo de qualquer página nova que deva exigir login.

## Status atual

- Landing page, login/cadastro e login com Google: funcionando em produção.
- Wizard de 7 etapas + popup de planos: visual pronto, protegido por login.
- Backend de pagamento (Fase 1+2 do plano): `/api/create-series`, `/api/create-checkout-session` e `/api/stripe-webhook` escritos. Supabase (schema aplicado), Stripe (6 Prices em modo teste + webhook) e as variáveis de ambiente na Vercel já configurados — falta testar o fluxo de pagamento ponta a ponta. Domínio de produção: `fluxreel.com.br`.
- Pipeline de geração do vídeo em si (roteiro → imagens → narração → legendas → render) ainda não foi construído — é o próximo passo.

## Próximos passos

- Fase 3 do backend: pipeline de geração (Claude Sonnet 5 pro roteiro, Z-Image Turbo pras imagens, ElevenLabs pra narração, Groq Whisper pras legendas, Creatomate pra montar o vídeo final) + Fase 4 (exibir o vídeo pronto pro usuário via Supabase Realtime). Plano detalhado no histórico de conversa/plans.
- Depois: dashboard (séries, vídeos, guias, fale conosco, configurações, status da assinatura, sair).
- Subir os assets (imagens, vídeos, áudios) listados no `LEIA-ME.txt`.

## Ao trabalhar neste projeto

- Explique o que entendeu da estrutura antes de fazer alterações grandes.
- Não gere zips ou nomes de arquivo com número de versão (ex.: `fluxreel_v3.zip`) — sempre o mesmo nome fixo.
- Nunca sobrescreva as chaves reais do Supabase em `auth.js` com placeholder.
