FROM ghcr.io/puppeteer/puppeteer:latest

# Beralih ke root untuk instalasi sistem
USER root

# Update dan instal library sistem yang sering dibutuhkan WA Web (seperti emoji dan font)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Gunakan cache Docker untuk mempercepat build dengan menyalin package files dulu
COPY package*.json ./

# Instal dependensi (menggunakan npm ci lebih stabil untuk production)
RUN npm install

# Salin seluruh kode proyek
COPY . .

# Pastikan folder sessions ada dan memiliki izin yang benar
# Kita berikan kepemilikan ke user 'pptruser' agar lebih aman
RUN mkdir -p sessions && chown -R pptruser:pptruser /app

# Beralih kembali ke user non-root (pptruser) yang sudah disediakan image dasar
# Ini penting untuk keamanan dan kompatibilitas Puppeteer
USER pptruser

# Jalankan aplikasi
CMD ["node", "index.js"]
