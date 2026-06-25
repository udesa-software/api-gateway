const jwt = require('jsonwebtoken');
const { createAuthHelpers } = require('../../auth');

const logger = { error: jest.fn() };
let redisClient;
let isPublicPath;
let verifyToken;

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('gateway auth helpers', () => {
  beforeEach(() => {
    redisClient = null;
    logger.error.mockClear();
    ({ isPublicPath, verifyToken } = createAuthHelpers({
      jwt,
      redisClient,
      userSecret: 'test-user-secret',
      adminSecret: 'test-admin-secret',
      logger,
    }));
  });

  test('detects public exact and prefix paths', () => {
    expect(isPublicPath('/health')).toBe(true);
    expect(isPublicPath('/api/auth/login')).toBe(true);
    expect(isPublicPath('/api/users/register')).toBe(true);
    expect(isPublicPath('/api/friends')).toBe(false);
  });

  test('passes public paths without a token', async () => {
    const req = { path: '/api/auth/login', headers: {} };
    const res = mockResponse();
    const next = jest.fn();

    await verifyToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  test('rejects invalid bearer token', async () => {
    const req = { path: '/api/friends', headers: { authorization: 'Bearer invalid' } };
    const res = mockResponse();
    const next = jest.fn();

    await verifyToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Token inválido o expirado' });
  });

  test('accepts a signed user token', async () => {
    const token = jwt.sign({ sub: 'user-1', token_version: 1 }, 'test-user-secret');
    const req = { path: '/api/friends', headers: { authorization: `Bearer ${token}` } };
    const res = mockResponse();
    const next = jest.fn();

    await verifyToken(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('accepts a signed admin token on admin routes', async () => {
    const token = jwt.sign({ sub: 'admin-1', role: 'admin' }, 'test-admin-secret');
    const req = { path: '/api/admin/users', headers: { authorization: `Bearer ${token}` } };
    const res = mockResponse();
    const next = jest.fn();

    await verifyToken(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('rejects a revoked token version from redis', async () => {
    ({ verifyToken } = createAuthHelpers({
      jwt,
      redisClient: { get: jest.fn().mockResolvedValue('2') },
      userSecret: 'test-user-secret',
      adminSecret: 'test-admin-secret',
      logger,
    }));
    const token = jwt.sign({ sub: 'user-1', token_version: 1 }, 'test-user-secret');
    const req = { path: '/api/friends', headers: { authorization: `Bearer ${token}` } };
    const res = mockResponse();
    const next = jest.fn();

    await verifyToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Sesión revocada. Iniciá sesión de nuevo.' });
  });

  test('logs redis verification errors and lets request continue', async () => {
    ({ verifyToken } = createAuthHelpers({
      jwt,
      redisClient: { get: jest.fn().mockRejectedValue(new Error('redis down')) },
      userSecret: 'test-user-secret',
      adminSecret: 'test-admin-secret',
      logger,
    }));
    const token = jwt.sign({ sub: 'user-1', token_version: 1 }, 'test-user-secret');
    const req = { path: '/api/friends', headers: { authorization: `Bearer ${token}` } };
    const res = mockResponse();
    const next = jest.fn();

    await verifyToken(req, res, next);

    expect(logger.error).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
