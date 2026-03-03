# Gunakan image yang sudah dioptimasi untuk puppeteer
FROM ghcr.io/puppeteer/puppeteer:21.1.1

USER root

# FIX GPG ERROR: Abaikan error update dari repo Google yang bermasalah agar build tetap lanjut
RUN apt-get update || true

# Instal dependensi sistem yang diperlukan
RUN apt-get install -y \
    ffmpeg \
    --no-install-recommends \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package.json & package-lock.json
COPY package*.json ./

# Instal dependensi (Pastikan qrcode terinstal)
RUN npm install --production && npm cache clean --force

# Copy seluruh file project
COPY . .

# SOLUSI PERMISSION DENIED:
# Kita gunakan 777 agar folder sessions bisa ditulis oleh siapa saja (aman di dalam kontainer)
RUN mkdir -p /app/sessions && chmod -R 777 /app/sessions

# Tetap gunakan root atau pptruser (777 sudah mencakup keduanya)
USER pptruser

CMD ["node", "index.js"]
