FROM ghcr.io/puppeteer/puppeteer:latest

USER root

# Instal dependensi tambahan untuk pengolahan media dan library sistem yang diperlukan
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libnss3 \
    libatk-bridge2.0-0 \
    libxcomposite1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Salin package.json dan instal library
COPY package*.json ./
RUN npm install

# Salin semua file project
COPY . .

# Buat folder sessions dengan izin akses penuh agar sesi WA tersimpan
RUN mkdir -p sessions && chmod -R 777 sessions

# Gunakan perintah ini agar Puppeteer bisa berjalan di lingkungan Docker
CMD ["node", "index.js"]
