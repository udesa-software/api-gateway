const { createProxyMiddleware } = require('http-proxy-middleware');

const FRIENDS_SERVICE_URL = process.env.FRIENDS_SERVICE_URL || 'http://localhost:3001';

module.exports = createProxyMiddleware({
  target: FRIENDS_SERVICE_URL,
  changeOrigin: true,
  pathFilter: '/api/friends',
});
