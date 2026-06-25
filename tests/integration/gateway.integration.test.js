process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-user-secret';
process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'test-admin-secret';

const request = require('supertest');
const { app } = require('../../app');

describe('api-gateway HTTP integration', () => {
  test('GET /health returns gateway status', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'api-gateway' });
  });

  test('unknown route returns 404 JSON', async () => {
    const response = await request(app).get('/unknown-route');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Ruta no encontrada' });
  });
});
