# FluxReel

Clone rebrandizado do site ViralIA (ferramenta de geração de vídeos virais por IA). Site estático puro — HTML/CSS/JS vanilla, sem framework, sem build step. Hospedado na Vercel, deploy automático a cada push no GitHub.

## Arquivos

- `index.html` — landing page pública. Hero, seção "estilos" (marquee com vídeos), carrossel "A gente entrega views" (imagens estáticas), monetização, depoimentos, "como funciona", FAQ. Botão "Entrar com Google" no cabeçalho.
- `login.html` — tela de login/cadastro (abas Entrar/Criar conta), botão Google + formulário e-mail/senha. Lê `?mode=signup` (abre direto na aba de cadastro) e `?next=` (pra onde voltar depois de logar).
- `create-series.html` — assistente de criação de série em 7 etapas (Nicho → Idioma e voz → Música de fundo → Estilo visual → Estilo de legenda → Efeitos → Detalhes da série) + popup de planos/pagamento no final. **Só a parte visual está pronta** — nenhuma API real de IA/pagamento conectada ainda. Exige login: redireciona pra `login.html` se não houver sessão (via `requireAuth()`).
- `auth.js` — toda a lógica de autenticação via Supabase (Google OAuth + e-mail/senha) e a proteção de páginas (`requireAuth()`). **Contém chaves reais** (Project URL e anon key do Supabase, nas 2 primeiras linhas com valor). Não são secretas (a `service_role key` que seria, e essa nunca é usada aqui), mas são configuração de produção — nunca sobrescreva essas duas linhas com placeholder.
- `logo-icon.webp` — ícone da marca.
- `LEIA-ME.txt` — lista de assets (imagens/vídeos/áudios) que ainda faltam subir pro site funcionar 100% (com os caminhos exatos esperados pelo código).

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
- Wizard de 7 etapas + popup de planos: pronto visualmente (client-side, sem backend), protegido por login.

## Próximos passos (ainda não iniciados)

- Conectar APIs reais: TTS (geração de voz), geração de imagem por estilo, transcrição + legendas queimadas no vídeo, geração de vídeo a partir de imagem ("gancho animado"), processamento de pagamento/assinatura.
- Subir os assets (imagens, vídeos, áudios) listados no `LEIA-ME.txt`.

## Ao trabalhar neste projeto

- Explique o que entendeu da estrutura antes de fazer alterações grandes.
- Não gere zips ou nomes de arquivo com número de versão (ex.: `fluxreel_v3.zip`) — sempre o mesmo nome fixo.
- Nunca sobrescreva as chaves reais do Supabase em `auth.js` com placeholder.
