const path = require('path');
const request = require('supertest');

process.env.KANECTA_DATASTORE = path.resolve(__dirname, '../../kanecta-datastore-sample');

const app = require('../src/app');

// f1a00002 is the "Clarify" item; its parent is f1a00001 "Base Work Process"
const KNOWN_ID = 'f1a00002-b45e-4c3d-9e7f-000000000001';

describe('GET /items/:id', () => {
  it('returns flat metadata when levels is not specified', async () => {
    const res = await request(app).get(`/items/${KNOWN_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(KNOWN_ID);
    expect(res.body.value).toBe('Clarify');
    expect(res.body.type).toBe('string');
    expect(res.body.children).toBeUndefined();
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

describe('GET /items/:id?levels=N', () => {
  it('levels=1 returns the item with no children', async () => {
    const res = await request(app).get(`/items/${KNOWN_ID}?levels=1`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(KNOWN_ID);
    expect(res.body.children).toBeUndefined();
  });

  it('levels=2 returns the item with its direct children', async () => {
    const res = await request(app).get(`/items/${KNOWN_ID}?levels=2`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(KNOWN_ID);
    expect(Array.isArray(res.body.children)).toBe(true);
    expect(res.body.children).toHaveLength(3);
    // children are sorted by sort_order
    expect(res.body.children[0].value).toBe('Confirm the goal and success criteria before starting');
    expect(res.body.children[1].value).toBe('Identify constraints (time, tech stack, compatibility)');
    expect(res.body.children[2].value).toBe('Ask questions now — not mid-build');
  });

  it('levels=3 returns the item with children and grandchildren', async () => {
    const res = await request(app).get(`/items/${KNOWN_ID}?levels=3`);
    expect(res.status).toBe(200);
    // children's children arrays should be present (empty for leaf nodes)
    expect(Array.isArray(res.body.children)).toBe(true);
    expect(Array.isArray(res.body.children[0].children)).toBe(true);
  });

  it('returns 400 when levels=0', async () => {
    const res = await request(app).get(`/items/${KNOWN_ID}?levels=0`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('levels must be a positive integer');
  });

  it('returns 400 when levels is not a number', async () => {
    const res = await request(app).get(`/items/${KNOWN_ID}?levels=abc`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('levels must be a positive integer');
  });
});
