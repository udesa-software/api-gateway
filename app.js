require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const Redis = require('ioredis');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { rateLimit } = require('express-rate-limit');
const { logger } = require('./observability/logger');
const { randomUUID } = require('crypto');
const { createAuthHelpers } = require('./auth');

const REDIS_URL = process.env.REDIS_URL;
let redisClient = null;

if (REDIS_URL) {
  redisClient = new Redis(REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    commandTimeout: 2000,
  });
  redisClient.on('error', (err) => logger.error({ err: err.message, event: 'redis.connection_error' }, 'redis.connection_error'));
} else {
  logger.warn({ event: 'redis.not_configured' }, 'redis.not_configured: token revocation disabled');
}

const app = express();

// Confiar en el primer proxy (AWS ALB) para identificar IPs reales de forma segura
app.set('trust proxy', 1);

//  CORS 
// Se configura una sola vez acá — los microservicios no necesitan cors propio
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3001', 'http://localhost:8081']; // web backoffice + expo

app.get(['/', '/health', '/api', '/api/health'], (_req, res) => {
  res.json({ status: 'ok', service: 'api-gateway' });
});

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));

//  RATE LIMITING GLOBAL 
// Límite general: 100 requests cada 15 minutos por IP
// Los microservicios pueden tener sus propios límites más específicos
const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  statusCode: 429,
});

app.use(globalRateLimiter);

//  HEADER DE TRAZABILIDAD + REQUEST LOGGING
// identifica qué instancia del gateway respondió y loggea cada request con duración
const SKIP_LOG = new Set(['/', '/health', '/api', '/api/health']);

app.use((req, res, next) => {
  req.headers['x-gateway'] = 'udesa-migos-gateway';
  if (!req.headers['x-request-id']) {
    req.headers['x-request-id'] = randomUUID();
  }

  if (SKIP_LOG.has(req.path)) return next();

  const start = Date.now();
  req.log = logger.child({ request_id: req.headers['x-request-id'] });

  res.on('finish', () => {
    const duration_ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    req.log[level](
      { method: req.method, path: req.path, status: res.statusCode, duration_ms },
      `${res.statusCode} ${req.method} ${req.path}`,
    );
  });

  next();
});

//  URLs DE LOS MICROSERVICIOS 
const USERS_SERVICE_URL = process.env.USERS_SERVICE_URL || 'http://localhost:3000';
const FRIENDS_SERVICE_URL = process.env.FRIENDS_SERVICE_URL || 'http://localhost:3001';
const LOCATION_SERVICE_URL = process.env.LOCATION_SERVICE_URL || 'http://localhost:3002';
const BACKOFFICE_SERVICE_URL = process.env.BACKOFFICE_SERVICE_URL || 'http://localhost:3003';
const NOTIFICATIONS_SERVICE_URL = process.env.NOTIFICATIONS_SERVICE_URL || 'http://localhost:8080';
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8001';

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;

const { isPublicPath, verifyToken } = createAuthHelpers({
  jwt,
  redisClient,
  userSecret: JWT_SECRET,
  adminSecret: ADMIN_JWT_SECRET,
  logger,
});

app.use(verifyToken);



//  PROXY HACIA USERS SERVICE 
// pathFilter en lugar de app.use('/api/auth', ...) para que Express no stripee el prefijo
app.use(createProxyMiddleware({
  target: USERS_SERVICE_URL,
  changeOrigin: true,
  pathFilter: ['/api/users', '/api/auth'],
  onError: (err, req) => {
    (req.log ?? logger).error({ err: err.message, target: 'users', path: req.path }, 'proxy.upstream_error');
  }
}));

//  PROXY HACIA BACKOFFICE SERVICE
app.use(createProxyMiddleware({
  target: BACKOFFICE_SERVICE_URL,
  changeOrigin: true,
  pathFilter: '/api/admin',
}));

//  PROXY HACIA FRIENDS SERVICE 
app.use(createProxyMiddleware({
  target: FRIENDS_SERVICE_URL,
  changeOrigin: true,
  pathFilter: '/api/friends',
}));

//  PROXY HACIA LOCATION SERVICE 
app.use(createProxyMiddleware({
  target: LOCATION_SERVICE_URL,
  changeOrigin: true,
  pathFilter: '/api/locations',
}));

//  PROXY HACIA NOTIFICATIONS SERVICE
app.use(createProxyMiddleware({
  target: NOTIFICATIONS_SERVICE_URL,
  changeOrigin: true,
  pathFilter: '/api/notifications',
  pathRewrite: { '^/api/notifications': '' },
}));

//  PROXY HACIA AI SERVICE
app.use(createProxyMiddleware({
  target: AI_SERVICE_URL,
  changeOrigin: true,
  pathFilter: '/api/ai',
}));

//  RUTA NO ENCONTRADA
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    logger.info({ port: PORT, event: 'gateway.started' }, 'api-gateway started');
  });
}

module.exports = { app, isPublicPath, verifyToken };
