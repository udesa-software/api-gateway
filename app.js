require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { rateLimit } = require('express-rate-limit');

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
const USERS_SERVICE_URL    = process.env.USERS_SERVICE_URL    || 'http://localhost:3000';
const FRIENDS_SERVICE_URL  = process.env.FRIENDS_SERVICE_URL  || 'http://localhost:3001';
const LOCATION_SERVICE_URL = process.env.LOCATION_SERVICE_URL || 'http://localhost:3002';

const JWT_SECRET       = process.env.JWT_SECRET;
const INTERNAL_SECRET  = process.env.INTERNAL_SECRET;

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

  // 1. Verificar firma del JWT
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  // 2. Los tokens de admin tienen payload.role — el users service los valida internamente
  if (payload.role) {
    return next();
  }

  // 3. Verificar token_version contra users service
  try {
    const response = await fetch(`${USERS_SERVICE_URL}/api/internal/validate-token`, {
      headers: {
        'authorization': authHeader,
        'x-internal-secret': INTERNAL_SECRET,
      },
    });

    if (!response.ok) {
      return res.status(401).json({ error: 'Sesión revocada. Iniciá sesión de nuevo.' });
    }
  } catch {
    return res.status(503).json({ error: 'No se pudo verificar el token. Intentá de nuevo.' });
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
  pathFilter: ['/api/users', '/api/auth', '/api/admin', '/api/admin-auth'],
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
