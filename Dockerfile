FROM ghcr.io/puppeteer/puppeteer:21.1.1

USER root

RUN apt-get update || true
RUN apt-get install -y ffmpeg --no-install-recommends && apt-get clean

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Beri izin ke seluruh folder /app agar user pptruser bisa menulis apa saja
RUN chmod -R 777 /app

# Gunakan root saja untuk sementara agar memastikan permission folder sessions tembus
USER root 

CMD ["node", "index.js"]
