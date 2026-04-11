FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY app.js ./
COPY utils.js ./
COPY routes/ ./routes/

CMD ["node", "app.js"]
