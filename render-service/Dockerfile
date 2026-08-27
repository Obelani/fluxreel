# ATENÇÃO: essa imagem é a parte mais provável de precisar ajuste no
# primeiro deploy real — não deu pra confirmar com certeza se o Revideo usa
# Puppeteer ou Playwright por baixo dos panos pra renderizar via navegador
# headless. Instalamos um Chromium do sistema via apt e apontamos a
# variável de ambiente mais comum (PUPPETEER_EXECUTABLE_PATH) pra ele —
# se o primeiro build falhar reclamando de não achar o navegador, é aqui
# que ajustamos.
FROM node:20-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROME_PATH=/usr/bin/chromium

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=4000
EXPOSE 4000

CMD ["npm", "run", "serve"]
