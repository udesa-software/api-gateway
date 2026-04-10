require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const { verifyToken } = require('./utils');
const usersProxy = require('./routes/users');
const friendsProxy = require('./routes/friends');
const locationProxy = require('./routes/location');

const app = express();

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3001', 'http://localhost:8081'];

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  statusCode: 429,
}));

app.use((req, _res, next) => {
  req.headers['x-gateway'] = 'udesa-migos-gateway';
  next();
});

app.use(verifyToken);

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'api-gateway' }));

app.use(usersProxy);
app.use(friendsProxy);
app.use(locationProxy);
app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API Gateway running on port ${PORT}`));
