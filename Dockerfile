FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY app.js .
COPY observability/ ./observability/

CMD ["node", "app.js"]
