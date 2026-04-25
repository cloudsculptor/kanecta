const path = require('path');
const request = require('supertest');

process.env.KANECTA_DATASTORE = path.resolve(__dirname, '../../kanecta-datastore-sample');

const app = require('../src/app');

// f1a00002 is the "Clarify" item imported from BASE.md
const KNOWN_ID = 'f1a00002-b45e-4c3d-9e7f-000000000001';

describe('GET /items/:id', () => {
  it('returns metadata for a valid existing item', async () => {
    const res = await request(app).get(`/items/${KNOWN_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(KNOWN_ID);
    expect(res.body.value).toBe('Clarify');
    expect(res.body.type).toBe('string');
  });

  it('returns 404 for a valid UUID that does not exist', async () => {
    const res = await request(app).get('/items/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Item not found');
  });

  it('returns 400 for a malformed ID', async () => {
    const res = await request(app).get('/items/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid UUID format');
  });
});
