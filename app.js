require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const Redis = require('ioredis');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { rateLimit } = require('express-rate-limit');

const REDIS_URL = process.env.REDIS_URL;
let redisClient = null;

if (REDIS_URL) {
  redisClient = new Redis(REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    commandTimeout: 2000,
  });
  redisClient.on('error', (err) => console.error('[Redis] connection error:', err.message));
} else {
  console.log('[Redis] No REDIS_URL provided. Skipping Redis features (token revocation).');
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

//  HEADER DE TRAZABILIDAD 
// identifica qué instancia del gateway respondió
app.use((req, _res, next) => {
  console.log(`[Gateway] ${req.method} ${req.url}`);
  req.headers['x-gateway'] = 'udesa-migos-gateway';
  next();
});

//  URLs DE LOS MICROSERVICIOS 
const USERS_SERVICE_URL = process.env.USERS_SERVICE_URL || 'http://localhost:3000';
const FRIENDS_SERVICE_URL = process.env.FRIENDS_SERVICE_URL || 'http://localhost:3001';
const LOCATION_SERVICE_URL = process.env.LOCATION_SERVICE_URL || 'http://localhost:3002';
const BACKOFFICE_SERVICE_URL = process.env.BACKOFFICE_SERVICE_URL || 'http://localhost:3003';

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;

//  RUTAS PÚBLICAS (no requieren JWT) 
const PUBLIC_PATHS_PREFIX = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/users/register',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/refresh',
  '/api/admin/auth/login',
];

const PUBLIC_PATHS_EXACT = [
  '/',
  '/api',
  '/health',
  '/api/health',
];

function isPublicPath(path) {
  return PUBLIC_PATHS_EXACT.includes(path) || PUBLIC_PATHS_PREFIX.some((p) => path.startsWith(p));
}

//  VERIFICACIÓN DE TOKEN_VERSION 
// Si el request trae JWT, verifica firma + llama al users service para
// confirmar que el token no fue revocado (token_version vigente).
// Rutas públicas y requests sin token pasan directo.
async function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];

  // Sin token o ruta pública → dejar pasar (el microservicio rechazará si lo necesita)
  if (!authHeader || !authHeader.startsWith('Bearer ') || isPublicPath(req.path)) {
    return next();
  }

  const token = authHeader.slice(7);

  // 1. Determinar qué secret usar según la ruta
  const isAdminRoute = req.path.startsWith('/api/admin');
  const secret = isAdminRoute ? ADMIN_JWT_SECRET : JWT_SECRET;

  // 2. Verificar firma del JWT
  let payload;
  try {
    payload = jwt.verify(token, secret);
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  // 3. Los tokens de admin tienen payload.role — el users service los valida internamente
  if (payload.role) {
    return next();
  }

  // 3. Verificar token_version contra Redis (O(1), sin llamada a users service)
  // Se saltea si Redis no está configurado.
  if (redisClient) {
    try {
      const revokedVersion = await redisClient.get(`revoked:${payload.sub}`);
      if (revokedVersion !== null && payload.token_version < parseInt(revokedVersion, 10)) {
        return res.status(401).json({ error: 'Sesión revocada. Iniciá sesión de nuevo.' });
      }
    } catch (err) {
      console.error('[Redis] skip verification due to error:', err.message);
    }
  }

  next();
}

app.use(verifyToken);



//  PROXY HACIA USERS SERVICE 
// pathFilter en lugar de app.use('/api/auth', ...) para que Express no stripee el prefijo
app.use(createProxyMiddleware({
  target: USERS_SERVICE_URL,
  changeOrigin: true,
  pathFilter: ['/api/users', '/api/auth'],
  onProxyRes: (proxyRes, req, res) => {
    console.log(`[Gateway] Proxy response from UsersService: ${proxyRes.statusCode} for ${req.method} ${req.url}`);
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

//  RUTA NO ENCONTRADA 
app.use((req, res) => {
  console.log(`[Gateway] 404 Not Found: ${req.method} ${req.url}`);
  res.status(404).json({ error: 'Ruta no encontrada' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});
