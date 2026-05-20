FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY app.js index.html styles.css manifest.json service-worker.js icon.svg logo.jpeg ./

ENV NODE_ENV=production
ENV PORT=4173
ENV DATA_DIR=/data

RUN mkdir -p /data

EXPOSE 4173

CMD ["node", "server.js"]
