const { createProxyMiddleware } = require('http-proxy-middleware');

const USERS_SERVICE_URL = process.env.USERS_SERVICE_URL || 'http://localhost:3000';

module.exports = createProxyMiddleware({
  target: USERS_SERVICE_URL,
  changeOrigin: true,
  pathFilter: ['/api/users', '/api/auth', '/api/admin', '/api/admin-auth'],
});
