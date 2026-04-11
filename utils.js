const jwt = require('jsonwebtoken');
const Redis = require('ioredis');

const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  lazyConnect: true,
  enableOfflineQueue: false,
});
redisClient.on('error', (err) => console.error('[Redis] connection error:', err));

const JWT_SECRET = process.env.JWT_SECRET;

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

async function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ') || isPublicPath(req.path)) {
    return next();
  }

  const token = authHeader.slice(7);

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  if (payload.role) {
    return next();
  }

  try {
    const revokedVersion = await redisClient.get(`revoked:${payload.sub}`);
    if (revokedVersion !== null && payload.token_version < parseInt(revokedVersion, 10)) {
      return res.status(401).json({ error: 'Sesión revocada. Iniciá sesión de nuevo.' });
    }
  } catch {
    // Redis no disponible — fail open, el JWT expira en 15 min
  }

  next();
}

module.exports = { verifyToken };
