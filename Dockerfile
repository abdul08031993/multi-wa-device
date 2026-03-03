# Gunakan image yang sudah dioptimasi untuk puppeteer
FROM ghcr.io/puppeteer/puppeteer:21.1.1

USER root

# Instal dependensi sistem yang minim
RUN apt-get update && apt-get install -y \
    ffmpeg \
    --no-install-recommends \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Pastikan package.json di-copy duluan
COPY package*.json ./

# Instal dependensi secara bersih (tanpa devDependencies)
RUN npm install --production && npm cache clean --force

# Copy file project (folder yang ada di .dockerignore otomatis akan diabaikan)
COPY . .

# Buat folder untuk menyimpan sesi agar tidak error permission
RUN mkdir -p sessions && chown -R pptruser:pptruser /app

USER pptruser

CMD ["node", "index.js"]
