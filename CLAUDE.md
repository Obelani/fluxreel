# FluxReel

Clone rebrandizado do site ViralIA (ferramenta de geração de vídeos virais por IA). Front estático — HTML/CSS/JS vanilla, sem framework, sem build step. Hospedado na Vercel, deploy automático a cada push no GitHub. Desde a adição do backend de geração de vídeos, o projeto também tem `/api` (Vercel Functions em Node) — ver seção **Backend** abaixo.

## Arquivos (front)

- `index.html` — landing page pública. Hero, seção "estilos" (marquee com vídeos), carrossel "A gente entrega views" (imagens estáticas), monetização, depoimentos, "como funciona", FAQ. Botão "Entrar com Google" no cabeçalho.
- `login.html` — tela de login/cadastro (abas Entrar/Criar conta), botão Google + formulário e-mail/senha. Lê `?mode=signup` (abre direto na aba de cadastro) e `?next=` (pra onde voltar depois de logar).
- `create-series.html` — assistente de criação de série em 7 etapas (Nicho → Idioma e voz → Música de fundo → Estilo visual → Estilo de legenda → Efeitos → Detalhes da série) + popup de planos/pagamento no final. O paywall chama `/api/create-series` e `/api/create-checkout-session` de verdade (Stripe Checkout); depois do pagamento confirmado, chama `/api/generate-video` e acompanha o progresso via Supabase Realtime (modal de geração com barra de progresso, player quando ficar pronto). Exige login: redireciona pra `login.html` se não houver sessão (via `requireAuth()`). Quem já tem pelo menos 1 série cai direto no `dashboard.html` (exceto voltando de checkout `?success=1` ou pedindo `?new=1` explicitamente).
- `dashboard.html` — painel logado: cards de resumo (plano atual, créditos, botão "Gerenciar assinatura" via Stripe Customer Portal) + abas Séries / Vídeos / Guias / Fale conosco / Configurações (troca via JS, mesmo padrão de `wizard-step` do `create-series.html`). Séries e vídeos são lidos **direto do Supabase no client** (`supabase.from('series'/'videos').select('*')`) — RLS já restringe à própria linha do usuário, sem precisar de endpoint novo. Botão "Gerar vídeo" por série reaproveita `/api/generate-video` + o mesmo modal de progresso/Realtime do wizard.
- `auth.js` — toda a lógica de autenticação via Supabase (Google OAuth + e-mail/senha) e a proteção de páginas (`requireAuth()`). **Contém chaves reais** (Project URL e anon key do Supabase, nas 2 primeiras linhas com valor). Não são secretas (a `service_role key` que seria, e essa nunca é usada aqui), mas são configuração de produção — nunca sobrescreva essas duas linhas com placeholder.
- `logo-icon.webp` — ícone da marca.
- `LEIA-ME.txt` — lista de assets (imagens/vídeos/áudios) que ainda faltam subir pro site funcionar 100% (com os caminhos exatos esperados pelo código).

## Backend (`/api`, Vercel Functions)

Não muda as convenções do front (continua sem build step, sem framework) — é uma pasta `/api` à parte, com seu próprio `package.json` na raiz (dependências Node: `stripe`, `@supabase/supabase-js`, `@anthropic-ai/sdk`, `@upstash/qstash`).

**Pagamento e créditos:**
- `api/_lib/supabaseAdmin.js` — client Supabase server-side, usa a `service_role key` (nunca exposta ao front).
- `api/_lib/auth.js` — `getAuthenticatedUser(req)`, valida o token Bearer (sessão Supabase) mandado pelo front e resolve o usuário. Toda function autenticada usa isso — nunca confiar em `user_id` vindo do client.
- `api/_lib/plans.js` — espelha os 3 planos definidos em `create-series.html` (`var PLANS`): mapeia plano+ciclo pro Price ID da Stripe e calcula quantos créditos cada ciclo de assinatura libera.
- `api/create-series.js` — salva a config do wizard (tabela `series`) assim que a etapa 7 termina, antes do paywall.
- `api/create-checkout-session.js` — cria a Stripe Checkout Session (assinatura) pro plano escolhido no paywall.
- `api/stripe-webhook.js` — recebe os eventos da Stripe, confirma pagamento e credita a conta do usuário (`grant_subscription_credits`, idempotente — protegido contra reentrega atrasada de evento, ver commit `f4345c0`). Também trata troca de plano: cancela a assinatura anterior só depois de confirmar a nova.
- `api/subscription-status.js` — devolve a assinatura ativa do usuário (usado pelo paywall pra mostrar "seu plano atual"/"trocar de plano", e pelo dashboard).
- `api/create-portal-session.js` — cria uma Stripe Billing Portal Session (o usuário troca cartão/cancela/vê fatura direto na página hospedada pela Stripe) — usado pelo botão "Gerenciar assinatura" no dashboard.

**Pipeline de geração do vídeo** (roteiro → imagens → narração → legendas → render), orquestrado via Upstash QStash — cada etapa processa e entrega a próxima pro QStash, que garante a entrega com retry se algo falhar:
- `api/generate-video.js` — debita 1 crédito (atômico), cria a linha em `videos`, dispara a 1ª etapa (`pipeline/script`). Devolve o crédito automaticamente se o pipeline falhar em qualquer etapa.
- `api/_lib/qstash.js` — publica a próxima etapa e verifica a assinatura das requisições recebidas do QStash.
- `api/_lib/pipelineStage.js` — helpers comuns a toda etapa: ler/verificar payload do QStash, marcar vídeo como falho + devolver crédito.
- `api/_lib/pipelineConfig.js` — mapeamentos entre o que o wizard oferece e o que cada API externa espera: duração → nº de cenas, voz → `voice_id` da ElevenLabs (**precisa preencher com IDs reais**, ver `Próximos passos`), estilo visual → prompt de imagem, estilo de legenda → visual do texto queimado.
- `api/pipeline/script.js` — roteiro cena a cena via Claude Sonnet 5 (tool use, JSON estruturado).
- `api/pipeline/images.js` — uma imagem por cena via fal.ai (`fal-ai/z-image/turbo`).
- `api/pipeline/narration.js` — narração completa via ElevenLabs, guardada no Supabase Storage (bucket `media`, público).
- `api/pipeline/captions.js` — transcrição com timestamp por palavra via Groq Whisper (`whisper-large-v3-turbo`).
- `api/pipeline/render.js` — monta os parâmetros da composição (imagens + durações por cena + narração + música + legenda) e manda pro `render-service` (Fly.io, ver seção **Render (Revideo, Fly.io)** abaixo). Diferente da Creatomate (removida), esse serviço não chama nenhum webhook de volta — ele mesmo sobe o vídeo pro Supabase e marca `ready`/`failed`, então essa function só dispara e retorna.

**Banco e config:**
- `supabase/schema.sql` — schema completo (tabelas `series`, `subscriptions`, `credit_balances`, `credit_ledger`, `videos` + RLS + funções atômicas de crédito). Aplicado manualmente no SQL Editor do Supabase; não há CLI/migrations configurado.
- `.env.example` — lista todas as variáveis de ambiente que o backend precisa. Copiar os valores reais só pra Vercel (Settings > Environment Variables), nunca commitar um `.env` de verdade.

Créditos: 1 crédito = 1 vídeo. Pacote fechado por ciclo de cobrança (não recarrega diariamente) — fórmula e valores em `api/_lib/plans.js`.

Existe uma skill em `~/.claude/skills/backend-foundations/` (nível de usuário, disponível em qualquer projeto) que audita/implementa os padrões genéricos usados aqui (autenticação, higiene de segredo, checklist de domínio, confiabilidade de webhook, saldo atômico, troca de plano) — invocável via `/backend-foundations`.

## Render (Revideo, Fly.io)

A etapa final do pipeline (montar o MP4 a partir de imagens+narração+música+legenda) roda **fora da Vercel**, num subprojeto à parte em `render-service/`, deployado no Fly.io como processo Node de longa duração (não é Vercel Function). Motivo: Creatomate custaria no mínimo US$45/mês em produção e nunca teve o schema de legenda 100% confirmado; o Revideo (github.com/midrender/revideo) é open source/gratuito e roda com controle total sobre a legenda via código.

- `render-service/src/scenes/video.tsx` — a composição em si (Revideo/TypeScript): imagens trocando por cena, áudio de narração + música, e o componente de legenda escrito à mão (palavra atual em destaque, resto apagado, cor/fundo por estilo). **Arquivo de maior incerteza** — ainda não testado com um render real; props exatas de `Layout`/`Rect` podem precisar de ajuste no primeiro deploy.
- `render-service/src/server.ts` — servidor Express: `POST /render` (autenticado por segredo compartilhado `RENDER_SERVICE_SECRET`), chama `renderVideo()` do Revideo, sobe o MP4 pro Supabase Storage (bucket `media`) e atualiza a linha em `videos` (`status='ready'`/`video_url`, ou `'failed'`+devolve crédito em caso de erro — mesmo padrão de `api/_lib/pipelineStage.js`).
- `render-service/Dockerfile` — Node 20 + ffmpeg + Chromium headless. **Segundo arquivo de maior incerteza** — ainda não confirmado se o Revideo usa Puppeteer ou Playwright internamente por baixo.
- `render-service/fly.toml` — `auto_stop_machines`/`min_machines_running=0`: a máquina liga só quando chega um render e desliga sozinha depois (cobrança por segundo, é o motivo de termos escolhido Fly.io em vez de Railway/Render).
- Variáveis do `render-service` (Supabase, `RENDER_SERVICE_SECRET`) ficam como `fly secrets set`, nunca na Vercel — a Vercel só precisa de `RENDER_SERVICE_URL` + `RENDER_SERVICE_SECRET` (ver `.env.example`) pra chamar o serviço.
- Ainda não deployado no Fly.io nem testado ponta a ponta — precisa de conta no Fly.io (criação de conta é ação que o usuário faz, não eu) e `flyctl deploy` a partir de `render-service/`.

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
- Google Cloud Console: projeto "fluxreel", OAuth Client tipo "Aplicativo da Web", origem autorizada = domínio canônico de produção (`https://www.fluxreel.com.br` — **com www**, é a variante que a Vercel serve direto; `fluxreel.com.br` sem www só redireciona 308 pra ela).
- Supabase → Authentication → URL Configuration: Site URL = `https://www.fluxreel.com.br`, Redirect URLs cobrindo `https://www.fluxreel.com.br/**`. Qualquer webhook externo (ex.: Stripe) também precisa usar o domínio com www — o sem-www não é seguido por chamadas servidor-pra-servidor.
- `REDIRECT_AFTER_LOGIN` em `auth.js` aponta pra `/create-series.html`.
- `requireAuth()` (em `auth.js`) é a função que protege páginas — chame no topo de qualquer página nova que deva exigir login.

## Status atual

- Landing page, login/cadastro e login com Google: funcionando em produção.
- Wizard de 7 etapas + popup de planos: visual pronto, protegido por login.
- Backend de pagamento (Fase 1+2): testado ponta a ponta em produção (modo teste da Stripe) — checkout, webhook, créditos e troca de plano funcionando, incluindo os bugs reais que apareceram no caminho (domínio sem www redirecionando e quebrando o webhook, reentrega atrasada de evento cancelando a assinatura ativa — ambos corrigidos).
- Pipeline de geração do vídeo (Fase 3+4): roteiro→imagens→narração→legendas testados ponta a ponta em produção com a Creatomate (primeiro vídeo gerado com sucesso). **Migração de render em andamento**: a etapa de render está sendo trocada da Creatomate pro Revideo self-hosted no Fly.io (ver seção **Render (Revideo, Fly.io)**) — código do `render-service/` e do novo `api/pipeline/render.js` já escritos, mas ainda não deployados/testados de ponta a ponta.
- Dashboard (`dashboard.html`): construído — Séries e Vídeos com dado real, assinatura/créditos, Guias e Fale conosco com conteúdo estático. Ainda não testado em produção pela primeira vez.

## Próximos passos

- **Deployar o `render-service/` no Fly.io** (conta + `flyctl` são passos do usuário) e testar um vídeo real de ponta a ponta — esperado precisar ajustar `video.tsx` e/ou o `Dockerfile` a partir do erro real do primeiro render (ambos sinalizados em comentário como maior incerteza).
- Depois do primeiro deploy funcionando, remover `CREATOMATE_API_KEY` da Vercel e adicionar `RENDER_SERVICE_URL`/`RENDER_SERVICE_SECRET` (já documentadas em `.env.example`).
- **Testar o dashboard pela primeira vez**: login com usuário que já tem série → confere se cai direto no dashboard (não no wizard); lista de séries/vídeos com dado real; "Gerar vídeo" numa série existente; "Gerenciar assinatura" abrindo o Stripe Customer Portal.
- Criar série adicional pelo dashboard ainda não existe (só pelo wizard) — decisão de produto pendente sobre como isso se relaciona com a quantidade de séries da assinatura.
- Subir os assets (imagens, vídeos, áudios) listados no `LEIA-ME.txt`.

## Ao trabalhar neste projeto

- Explique o que entendeu da estrutura antes de fazer alterações grandes.
- Não gere zips ou nomes de arquivo com número de versão (ex.: `fluxreel_v3.zip`) — sempre o mesmo nome fixo.
- Nunca sobrescreva as chaves reais do Supabase em `auth.js` com placeholder.
