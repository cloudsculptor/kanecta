'use strict';

class KanectaClient {
  constructor(baseUrl, token) {
    this._base = baseUrl.replace(/\/$/, '');
    this._token = token;
  }

  async _fetch(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this._token) headers['Authorization'] = `Bearer ${this._token}`;
    const res = await fetch(`${this._base}${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Kanecta API ${res.status}: ${text}`);
    }
    return res.json();
  }

  get items() {
    const c = this;
    return {
      list: () => c._fetch('GET', '/items'),
      root: () => c._fetch('GET', '/items/root'),
      get: (id) => c._fetch('GET', `/items/${id}`),
      create: (payload) => c._fetch('POST', '/items', payload),
      update: (id, payload) => c._fetch('PUT', `/items/${id}`, payload),
      delete: (id, force = false) => c._fetch('DELETE', `/items/${id}${force ? '?force=true' : ''}`),
      children: (id) => c._fetch('GET', `/items/${id}/children`),
      tree: (id, depth) =>
        c._fetch('GET', `/items/${id}/tree${depth != null ? `?depth=${depth}` : ''}`),
      annotations: (id) => c._fetch('GET', `/items/${id}/annotations`),
      annotate: (id, payload) => c._fetch('POST', `/items/${id}/annotations`, payload),
      relationships: (id) => c._fetch('GET', `/items/${id}/relationships`),
      backlinks: (id) => c._fetch('GET', `/items/${id}/backlinks`),
      history: (id) => c._fetch('GET', `/items/${id}/history`),
      getObject: (id) => c._fetch('GET', `/items/${id}/object`),
      saveObject: (id, data) => c._fetch('PUT', `/items/${id}/object`, data),
    };
  }
}

/**
 * Create a Kanecta API client.
 *
 * Reads KANECTA_API_URL (default http://localhost:3001) and KANECTA_TOKEN
 * from the environment unless overridden via options.
 */
function createClient(options = {}) {
  const baseUrl = options.baseUrl ?? process.env.KANECTA_API_URL ?? 'http://localhost:3001';
  const token = options.token ?? process.env.KANECTA_TOKEN;
  return new KanectaClient(baseUrl, token);
}

module.exports = { createClient, KanectaClient };
