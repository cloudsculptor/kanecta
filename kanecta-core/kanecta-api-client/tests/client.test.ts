import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, KanectaApiClient, createApiClient } from '../index.ts';

// ─── Fetch mocking helpers ──────────────────────────────────────────────────

/** Build a minimal fetch Response-like object. */
function mockResponse(
  body: unknown,
  { ok = true, status = 200, statusText = 'OK', json = true }: { ok?: boolean; status?: number; statusText?: string; json?: boolean } = {},
) {
  return {
    ok,
    status,
    statusText,
    json: json
      ? async () => body
      : async () => {
          throw new Error('not json');
        },
  } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(mockResponse({}));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function lastCall() {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return { url: call[0] as string, init: call[1] as RequestInit };
}

// ─── createApiClient ─────────────────────────────────────────────────────────

describe('createApiClient', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('defaults to http://localhost:3001 when nothing is configured', async () => {
    delete process.env.KANECTA_API_URL;
    delete process.env.KANECTA_TOKEN;
    const client = createApiClient();
    await client.config.get();
    expect(lastCall().url).toBe('http://localhost:3001/config');
  });

  it('reads KANECTA_API_URL from the environment', async () => {
    process.env.KANECTA_API_URL = 'https://api.example.com';
    delete process.env.KANECTA_TOKEN;
    const client = createApiClient();
    await client.config.get();
    expect(lastCall().url).toBe('https://api.example.com/config');
  });

  it('options.baseUrl overrides the environment', async () => {
    process.env.KANECTA_API_URL = 'https://env.example.com';
    const client = createApiClient({ baseUrl: 'https://opt.example.com' });
    await client.config.get();
    expect(lastCall().url).toBe('https://opt.example.com/config');
  });

  it('strips a trailing slash from baseUrl', async () => {
    const client = new KanectaApiClient('https://api.example.com/');
    await client.config.get();
    expect(lastCall().url).toBe('https://api.example.com/config');
  });

  it('reads KANECTA_TOKEN from the environment', async () => {
    process.env.KANECTA_TOKEN = 'env-token';
    const client = createApiClient({ baseUrl: 'https://api.example.com' });
    await client.config.get();
    const headers = lastCall().init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer env-token');
  });
});

// ─── Token handling ──────────────────────────────────────────────────────────

describe('token handling', () => {
  it('sends Authorization: Bearer <token> for a static string token', async () => {
    const client = new KanectaApiClient('https://api.example.com', 'my-static-token');
    await client.config.get();
    const headers = lastCall().init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-static-token');
  });

  it('resolves a FUNCTION token per request, picking up fresh values', async () => {
    let counter = 0;
    const tokenFn = vi.fn(async () => `token-${++counter}`);
    const client = new KanectaApiClient('https://api.example.com', tokenFn);

    await client.config.get();
    expect((lastCall().init.headers as Record<string, string>)['Authorization']).toBe('Bearer token-1');

    await client.config.get();
    expect((lastCall().init.headers as Record<string, string>)['Authorization']).toBe('Bearer token-2');

    expect(tokenFn).toHaveBeenCalledTimes(2);
  });

  it('omits Authorization header when token is null', async () => {
    const client = new KanectaApiClient('https://api.example.com', null as unknown as string);
    await client.config.get();
    const headers = lastCall().init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('omits Authorization header when token is undefined', async () => {
    const client = new KanectaApiClient('https://api.example.com');
    await client.config.get();
    const headers = lastCall().init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('omits Authorization header when a FUNCTION token resolves to null', async () => {
    const client = new KanectaApiClient('https://api.example.com', async () => null);
    await client.config.get();
    const headers = lastCall().init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });
});

// ─── ApiError ────────────────────────────────────────────────────────────────

describe('ApiError', () => {
  it('throws ApiError with status + message from a JSON error body', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ error: 'Item not found' }, { ok: false, status: 404, statusText: 'Not Found' }),
    );
    const client = new KanectaApiClient('https://api.example.com');
    await expect(client.items.get('missing-id')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'Item not found',
    });
    await expect(client.items.get('missing-id')).rejects.toBeInstanceOf(ApiError);
  });

  it('falls back to statusText when the error body has no `error` field', async () => {
    fetchMock.mockResolvedValue(mockResponse({}, { ok: false, status: 500, statusText: 'Internal Server Error' }));
    const client = new KanectaApiClient('https://api.example.com');
    await expect(client.items.get('x')).rejects.toMatchObject({
      status: 500,
      message: 'Internal Server Error',
    });
  });

  it('does not crash when the error response body is not valid JSON', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(undefined, { ok: false, status: 502, statusText: 'Bad Gateway', json: false }),
    );
    const client = new KanectaApiClient('https://api.example.com');
    await expect(client.items.get('x')).rejects.toMatchObject({
      status: 502,
      message: 'Bad Gateway',
    });
  });
});

// ─── workingSets ─────────────────────────────────────────────────────────────

describe('workingSets', () => {
  let client: KanectaApiClient;

  beforeEach(() => {
    client = new KanectaApiClient('https://api.example.com');
  });

  it('list() issues GET /working-sets', async () => {
    fetchMock.mockResolvedValue(mockResponse({ workingSets: [], activeWorkingSet: 'main' }));
    const result = await client.workingSets.list();
    const { url, init } = lastCall();
    expect(url).toBe('https://api.example.com/working-sets');
    expect(init.method).toBe('GET');
    expect(result).toEqual({ workingSets: [], activeWorkingSet: 'main' });
  });

  it('activate() issues POST /working-sets/:name/activate, encoding the name', async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: true }));
    await client.workingSets.activate('feature/x');
    const { url, init } = lastCall();
    expect(url).toBe('https://api.example.com/working-sets/feature%2Fx/activate');
    expect(init.method).toBe('POST');
  });

  it('createBranch() with no options sends a bare body', async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: true, branch: { name: 'b', active: true, baseBranch: null } }));
    await client.workingSets.createBranch('main', 'feature/x');
    const { url, init } = lastCall();
    expect(url).toBe('https://api.example.com/working-sets/main/branches');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ branchName: 'feature/x' });
    expect(body.fill).toBeUndefined();
    expect(body.upstream).toBeUndefined();
  });

  it('createBranch() includes fill + upstream when provided', async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: true, branch: { name: 'b', active: true, baseBranch: 'main' } }));
    await client.workingSets.createBranch('main', 'feature/x', { fill: 'sparse', upstream: { branch: 'main' } });
    const { init } = lastCall();
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ branchName: 'feature/x', fill: 'sparse', upstream: { branch: 'main' } });
  });

  it('createBranch() omits fill/upstream individually when only one is set', async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: true, branch: {} }));
    await client.workingSets.createBranch('main', 'feature/x', { fill: 'sparse' });
    let body = JSON.parse(lastCall().init.body as string);
    expect(body).toEqual({ branchName: 'feature/x', fill: 'sparse' });

    await client.workingSets.createBranch('main', 'feature/x', { upstream: { branch: 'main' } });
    body = JSON.parse(lastCall().init.body as string);
    expect(body).toEqual({ branchName: 'feature/x', upstream: { branch: 'main' } });
  });

  it('switchBranch() issues POST with encoded name + branch', async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: true, branch: 'feature/x' }));
    await client.workingSets.switchBranch('my set', 'feature/x');
    const { url, init } = lastCall();
    expect(url).toBe('https://api.example.com/working-sets/my%20set/branches/feature%2Fx/switch');
    expect(init.method).toBe('POST');
  });

  it('branchDiff() issues GET with encoded name + branch', async () => {
    fetchMock.mockResolvedValue(mockResponse({ branch: 'feature/x', adds: 1, edits: 0, deletes: 0 }));
    await client.workingSets.branchDiff('main', 'feature/x');
    const { url, init } = lastCall();
    expect(url).toBe('https://api.example.com/working-sets/main/branches/feature%2Fx/diff');
    expect(init.method).toBe('GET');
  });

  it('mergePreview() issues GET .../merge-preview', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ branch: 'feature/x', adds: 0, edits: 0, deletes: 0, conflicts: [], blastRadius: [] }),
    );
    await client.workingSets.mergePreview('main', 'feature/x');
    const { url, init } = lastCall();
    expect(url).toBe('https://api.example.com/working-sets/main/branches/feature%2Fx/merge-preview');
    expect(init.method).toBe('GET');
  });

  it('merge() with no options sends POST with an empty body', async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: true, merged: 3 }));
    await client.workingSets.merge('main', 'feature/x');
    const { url, init } = lastCall();
    expect(url).toBe('https://api.example.com/working-sets/main/branches/feature%2Fx/merge');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it('merge() with options sends them verbatim in the body', async () => {
    fetchMock.mockResolvedValue(mockResponse({ ok: true, merged: 1, conflicts: [] }));
    await client.workingSets.merge('main', 'feature/x', { strategy: 'ours', blockOnBlastRadius: true });
    const { init } = lastCall();
    expect(JSON.parse(init.body as string)).toEqual({ strategy: 'ours', blockOnBlastRadius: true });
  });
});

// ─── Representative sample of other API groups ──────────────────────────────

describe('items', () => {
  let client: KanectaApiClient;

  beforeEach(() => {
    client = new KanectaApiClient('https://api.example.com', 'tok');
  });

  it('create() issues POST /items with the payload as the body', async () => {
    fetchMock.mockResolvedValue(mockResponse({ id: 'new-id', type: 'task', createdAt: 'now' }));
    const payload = { value: 'Do the thing', type: 'task' };
    await client.items.create(payload);
    const { url, init } = lastCall();
    expect(url).toBe('https://api.example.com/items');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it('get() issues GET /items/:id', async () => {
    fetchMock.mockResolvedValue(mockResponse({ id: 'abc', type: 'task', createdAt: 'now' }));
    const result = await client.items.get('abc');
    const { url, init } = lastCall();
    expect(url).toBe('https://api.example.com/items/abc');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(result).toEqual({ id: 'abc', type: 'task', createdAt: 'now' });
  });

  it('delete() without force omits the query string', async () => {
    fetchMock.mockResolvedValue(mockResponse({ deleted: ['abc'] }));
    await client.items.delete('abc');
    expect(lastCall().url).toBe('https://api.example.com/items/abc');
  });

  it('delete() with force=true appends ?force=true', async () => {
    fetchMock.mockResolvedValue(mockResponse({ deleted: ['abc'] }));
    await client.items.delete('abc', true);
    expect(lastCall().url).toBe('https://api.example.com/items/abc?force=true');
  });
});

describe('aliases', () => {
  let client: KanectaApiClient;

  beforeEach(() => {
    client = new KanectaApiClient('https://api.example.com');
  });

  it('list() with no targetId omits the query string', async () => {
    fetchMock.mockResolvedValue(mockResponse([]));
    await client.aliases.list();
    expect(lastCall().url).toBe('https://api.example.com/aliases');
  });

  it('list() with targetId appends an encoded query string', async () => {
    fetchMock.mockResolvedValue(mockResponse([]));
    await client.aliases.list('id with spaces');
    expect(lastCall().url).toBe('https://api.example.com/aliases?targetId=id%20with%20spaces');
  });

  it('resolve() encodes the alias in the path', async () => {
    fetchMock.mockResolvedValue(mockResponse({ alias: 'a/b', targetId: 'x' }));
    await client.aliases.resolve('a/b');
    expect(lastCall().url).toBe('https://api.example.com/aliases/a%2Fb');
  });

  it('set() posts { alias, targetId } to /aliases', async () => {
    fetchMock.mockResolvedValue(mockResponse({ alias: 'a', targetId: 'x' }));
    await client.aliases.set('a', 'x');
    const { url, init } = lastCall();
    expect(url).toBe('https://api.example.com/aliases');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ alias: 'a', targetId: 'x' });
  });

  it('remove() encodes the alias and issues DELETE', async () => {
    fetchMock.mockResolvedValue(mockResponse({ removed: 'a/b' }));
    await client.aliases.remove('a/b');
    const { url, init } = lastCall();
    expect(url).toBe('https://api.example.com/aliases/a%2Fb');
    expect(init.method).toBe('DELETE');
  });
});

describe('integrity.streamUrl', () => {
  let client: KanectaApiClient;

  beforeEach(() => {
    client = new KanectaApiClient('https://api.example.com');
  });

  it('with no query returns a bare URL', () => {
    expect(client.integrity.streamUrl()).toBe('https://api.example.com/integrity/stream');
  });

  it('includes checks as a comma-joined list', () => {
    expect(client.integrity.streamUrl({ checks: ['orphans', 'dangling-refs'] })).toBe(
      'https://api.example.com/integrity/stream?checks=orphans%2Cdangling-refs',
    );
  });

  it('includes groups as a comma-joined list', () => {
    expect(client.integrity.streamUrl({ groups: ['structure', 'spec'] })).toBe(
      'https://api.example.com/integrity/stream?groups=structure%2Cspec',
    );
  });

  it('combines checks and groups', () => {
    expect(client.integrity.streamUrl({ checks: ['orphans'], groups: ['structure'] })).toBe(
      'https://api.example.com/integrity/stream?checks=orphans&groups=structure',
    );
  });

  it('omits empty arrays from the query string', () => {
    expect(client.integrity.streamUrl({ checks: [], groups: [] })).toBe('https://api.example.com/integrity/stream');
  });
});
