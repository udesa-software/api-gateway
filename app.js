require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const Redis = require('ioredis');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { rateLimit } = require('express-rate-limit');

const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  lazyConnect: true,
  enableOfflineQueue: false,
});
redisClient.on('error', (err) => console.error('[Redis] connection error:', err));

const app = express();

//  CORS 
// Se configura una sola vez acá — los microservicios no necesitan cors propio
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3001', 'http://localhost:8081']; // web backoffice + expo

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
  req.headers['x-gateway'] = 'udesa-migos-gateway';
  next();
});

//  URLs DE LOS MICROSERVICIOS 
const USERS_SERVICE_URL       = process.env.USERS_SERVICE_URL       || 'http://localhost:3000';
const FRIENDS_SERVICE_URL     = process.env.FRIENDS_SERVICE_URL     || 'http://localhost:3001';
const LOCATION_SERVICE_URL    = process.env.LOCATION_SERVICE_URL    || 'http://localhost:3002';
const BACKOFFICE_SERVICE_URL  = process.env.BACKOFFICE_SERVICE_URL  || 'http://localhost:3003';

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;

//  RUTAS PÚBLICAS (no requieren JWT) 
// Cualquier path que empiece con alguno de estos no pasa por verifyToken
const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/users/register',
  '/api/users/verify-email',
  '/api/users/resend-verification',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/refresh',
  '/api/admin/auth/login',
];

function isPublicPath(path) {
  return PUBLIC_PATHS.some((p) => path.startsWith(p));
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
  // El users service escribe `revoked:{userId}` con la nueva token_version cada vez que
  // hace logout o cambia contraseña. Si la versión del JWT es menor, el token fue revocado.
  try {
    const revokedVersion = await redisClient.get(`revoked:${payload.sub}`);
    if (revokedVersion !== null && payload.token_version < parseInt(revokedVersion, 10)) {
      return res.status(401).json({ error: 'Sesión revocada. Iniciá sesión de nuevo.' });
    }
  } catch {
    // Redis no disponible — fail open: el JWT ya fue verificado criptográficamente
    // y expira en 15 min, mismo TTL que la clave de Redis
  }

  next();
}

app.use(verifyToken);

//  HEALTHCHECK DEL GATEWAY 
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api-gateway' });
});

//  PROXY HACIA USERS SERVICE 
// pathFilter en lugar de app.use('/api/auth', ...) para que Express no stripee el prefijo
app.use(createProxyMiddleware({
  target: USERS_SERVICE_URL,
  changeOrigin: true,
  pathFilter: ['/api/users', '/api/auth'],
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
app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API Gateway running on port ${PORT}`);
});
