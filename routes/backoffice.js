const { createProxyMiddleware } = require('http-proxy-middleware');

const BACKOFFICE_SERVICE_URL = process.env.BACKOFFICE_SERVICE_URL || 'http://localhost:3003';

module.exports = createProxyMiddleware({
  target: BACKOFFICE_SERVICE_URL,
  changeOrigin: true,
  pathFilter: ['/api/admin', '/api/admin-auth'],
  pathRewrite: {
    '^/api/admin/auth': '/api/auth',
    '^/api/admin': '/api/admins', 
    '^/api/admin-auth': '/api/auth'
  }
});
