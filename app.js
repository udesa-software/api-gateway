require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { rateLimit } = require('express-rate-limit');

const app = express();

// ─── CORS ────────────────────────────────────────────────────────────────────
// Se configura una sola vez acá — los microservicios no necesitan cors propio
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3001', 'http://localhost:8081']; // web backoffice + expo

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));

// ─── RATE LIMITING GLOBAL ────────────────────────────────────────────────────
// Límite general: 100 requests cada 15 minutos por IP
// Los microservicios pueden tener sus propios límites más específicos
const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  statusCode: 429,
});

app.use(globalRateLimiter);

// ─── HEADER DE TRAZABILIDAD ──────────────────────────────────────────────────
// identifica qué instancia del gateway respondió
app.use((req, _res, next) => {
  req.headers['x-gateway'] = 'udesa-migos-gateway';
  next();
});

// ─── URLs DE LOS MICROSERVICIOS ──────────────────────────────────────────────
const USERS_SERVICE_URL    = process.env.USERS_SERVICE_URL    || 'http://localhost:3000';
const FRIENDS_SERVICE_URL  = process.env.FRIENDS_SERVICE_URL  || 'http://localhost:3001';
const LOCATION_SERVICE_URL = process.env.LOCATION_SERVICE_URL || 'http://localhost:3002';

// ─── HEALTHCHECK DEL GATEWAY ─────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api-gateway' });
});

// ─── PROXY HACIA USERS SERVICE ───────────────────────────────────────────────
// Maneja: /api/users/*, /api/auth/*, /api/admin/*
// pathFilter en lugar de app.use('/api/auth', ...) para que Express no stripee el prefijo
app.use(createProxyMiddleware({
  target: USERS_SERVICE_URL,
  changeOrigin: true, //Cuando el gateway reenvía el request, en el header Host originalmente dice localhost:4000 (porque así lo mandó la app). Con changeOrigin: true el proxy cambia ese header a users:3000 antes de mandarlo. Algunos servidores rechazan requests donde el Host no coincide con ellos mismos, por eso se cambia.
  pathFilter: ['/api/users', '/api/auth', '/api/admin'],
}));

// ─── PROXY HACIA FRIENDS SERVICE ─────────────────────────────────────────────
app.use(createProxyMiddleware({
  target: FRIENDS_SERVICE_URL,
  changeOrigin: true,
  pathFilter: '/api/friends',
}));

// ─── PROXY HACIA LOCATION SERVICE ────────────────────────────────────────────
app.use(createProxyMiddleware({
  target: LOCATION_SERVICE_URL,
  changeOrigin: true,
  pathFilter: '/api/locations',
}));

// ─── RUTA NO ENCONTRADA ───────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});
