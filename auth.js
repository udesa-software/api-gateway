function createAuthHelpers({ jwt, redisClient, userSecret, adminSecret, logger }) {
  const publicPathPrefixes = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/users/register',
    '/api/auth/verify-email',
    '/api/auth/resend-verification',
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    '/api/auth/refresh',
    '/api/admin/auth/login',
    '/api/admin/auth/refresh',
  ];

  const publicPathExact = [
    '/',
    '/api',
    '/health',
    '/api/health',
  ];

  function isPublicPath(path) {
    return publicPathExact.includes(path) || publicPathPrefixes.some((p) => path.startsWith(p));
  }

  async function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ') || isPublicPath(req.path)) {
      return next();
    }

    const token = authHeader.slice(7);
    const isAdminRoute = req.path.startsWith('/api/admin');
    const secret = isAdminRoute ? adminSecret : userSecret;

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }

    if (payload.role) {
      return next();
    }

    if (redisClient) {
      try {
        const revokedVersion = await redisClient.get(`revoked:${payload.sub}`);
        if (revokedVersion !== null && payload.token_version < parseInt(revokedVersion, 10)) {
          return res.status(401).json({ error: 'Sesión revocada. Iniciá sesión de nuevo.' });
        }
      } catch (err) {
        logger.error({ err: err.message, event: 'redis.verification_error' }, 'redis.verification_error');
      }
    }

    return next();
  }

  return { isPublicPath, verifyToken };
}

module.exports = { createAuthHelpers };
