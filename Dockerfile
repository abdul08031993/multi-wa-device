FROM ghcr.io/puppeteer/puppeteer:latest

USER root

# Instal dependensi tambahan jika diperlukan
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Berikan izin akses folder session agar bisa menyimpan data login
RUN mkdir -p sessions && chmod -R 777 sessions

CMD ["node", "index.js"]