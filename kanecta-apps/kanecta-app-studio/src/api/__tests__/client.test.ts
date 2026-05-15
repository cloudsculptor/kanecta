import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeClient, ApiError } from '../client';

describe('makeClient', () => {
  const BASE = 'http://localhost:3000';
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    client = makeClient(BASE);
    vi.stubGlobal('fetch', vi.fn());
  });

  it('GET resolves on 200', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: '1' }), { status: 200 }),
    );
    const result = await client.get<{ id: string }>('/items');
    expect(result).toEqual({ id: '1' });
    expect(fetch).toHaveBeenCalledWith(`${BASE}/items`, expect.objectContaining({}));
  });

  it('GET throws ApiError on 404', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
    );
    let caughtStatus: number | undefined;
    await client.get('/items/bad').catch((e: ApiError) => { caughtStatus = e.status; });
    expect(caughtStatus).toBe(404);
  });

  it('POST sends JSON body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: '2' }), { status: 201 }),
    );
    await client.post('/items', { value: 'hello', type: 'note' });
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/items`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ value: 'hello', type: 'note' }),
      }),
    );
  });

  it('PUT sends JSON body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: '2', value: 'updated' }), { status: 200 }),
    );
    await client.put('/items/2', { value: 'updated' });
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/items/2`,
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('DELETE sends DELETE method', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ deleted: '2' }), { status: 200 }),
    );
    await client.delete('/items/2');
    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/items/2`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
