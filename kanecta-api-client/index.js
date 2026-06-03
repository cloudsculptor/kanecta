'use strict';

class KanectaApiClient {
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

  // ─── Config / system ────────────────────────────────────────────────────────

  get config() {
    const c = this;
    return {
      get: () => c._fetch('GET', '/config'),
      openInVSCode: (path) => c._fetch('POST', '/open-in-vscode', { path }),
      openPath: (path) => c._fetch('POST', '/open-path', { path }),
      openInBrowser: (path) => c._fetch('POST', '/open-in-browser', { path }),
    };
  }

  // ─── Search ─────────────────────────────────────────────────────────────────

  search(q, options = {}) {
    const params = new URLSearchParams({ q });
    if (options.rootId) params.set('rootId', options.rootId);
    if (options.limit != null) params.set('limit', String(options.limit));
    if (options.fields != null) {
      params.set('fields', Array.isArray(options.fields) ? options.fields.join(',') : options.fields);
    }
    return this._fetch('GET', `/search?${params}`);
  }

  // ─── Items ──────────────────────────────────────────────────────────────────

  get items() {
    const c = this;
    return {
      list: () => c._fetch('GET', '/items'),
      root: () => c._fetch('GET', '/items/root'),
      stats: () => c._fetch('GET', '/items/stats'),
      get: (id) => c._fetch('GET', `/items/${id}`),
      create: (payload) => c._fetch('POST', '/items', payload),
      bulkCreate: (items) => c._fetch('POST', '/items/bulk', { items }),
      update: (id, payload) => c._fetch('PUT', `/items/${id}`, payload),
      bulkUpdate: (updates) => c._fetch('PATCH', '/items/bulk', { updates }),
      delete: (id, force = false) => c._fetch('DELETE', `/items/${id}${force ? '?force=true' : ''}`),
      children: (id) => c._fetch('GET', `/items/${id}/children`),
      tree: (id, depth) =>
        c._fetch('GET', `/items/${id}/tree${depth != null ? `?depth=${depth}` : ''}`),
      ancestors: (id) => c._fetch('GET', `/items/${id}/ancestors`),
      clone: (id, payload) => c._fetch('POST', `/items/${id}/clone`, payload),
      annotations: (id) => c._fetch('GET', `/items/${id}/annotations`),
      annotate: (id, payload) => c._fetch('POST', `/items/${id}/annotations`, payload),
      relationships: (id) => c._fetch('GET', `/items/${id}/relationships`),
      backlinks: (id) => c._fetch('GET', `/items/${id}/backlinks`),
      history: (id) => c._fetch('GET', `/items/${id}/history`),
      getObject: (id) => c._fetch('GET', `/items/${id}/object`),
      saveObject: (id, data) => c._fetch('PUT', `/items/${id}/object`, data),
      complete: (id, actor) => c._fetch('POST', `/items/${id}/complete`, actor ? { actor } : {}),
      uncomplete: (id, actor) => c._fetch('POST', `/items/${id}/uncomplete`, actor ? { actor } : {}),
      getFunction: (id) => c._fetch('GET', `/items/${id}/function`),
      saveFunction: (id, payload) => c._fetch('PUT', `/items/${id}/function`, payload),
      getFunctionScaffold: (id) => c._fetch('GET', `/items/${id}/function/scaffold`),
      compileFunction: (id) => c._fetch('POST', `/items/${id}/function/compile`, {}),
      runFunction: (id, args = {}) => c._fetch('POST', `/items/${id}/function/run`, { args }),
    };
  }

  // ─── Tree ────────────────────────────────────────────────────────────────────

  get tree() {
    const c = this;
    return {
      get: (depth) => c._fetch('GET', `/tree${depth != null ? `?depth=${depth}` : ''}`),
    };
  }

  // ─── Aliases ─────────────────────────────────────────────────────────────────

  get aliases() {
    const c = this;
    return {
      list: (targetId) =>
        c._fetch('GET', `/aliases${targetId ? `?targetId=${encodeURIComponent(targetId)}` : ''}`),
      resolve: (alias) => c._fetch('GET', `/aliases/${encodeURIComponent(alias)}`),
      set: (alias, targetId) => c._fetch('POST', '/aliases', { alias, targetId }),
      remove: (alias) => c._fetch('DELETE', `/aliases/${encodeURIComponent(alias)}`),
    };
  }

  // ─── Relationships ───────────────────────────────────────────────────────────

  get relationships() {
    const c = this;
    return {
      list: () => c._fetch('GET', '/relationships'),
      create: (payload) => c._fetch('POST', '/relationships', payload),
    };
  }

  // ─── Tags ────────────────────────────────────────────────────────────────────

  get tags() {
    const c = this;
    return {
      byTag: (tag) => c._fetch('GET', `/tags/${encodeURIComponent(tag)}`),
    };
  }

  // ─── Types ───────────────────────────────────────────────────────────────────

  get types() {
    const c = this;
    return {
      list: () => c._fetch('GET', '/types'),
      create: (value) => c._fetch('POST', '/types', { value }),
      get: (id) => c._fetch('GET', `/types/${id}`),
      getSchema: (id) => c._fetch('GET', `/types/${id}/schema`),
      updateSchema: (id, schema) => c._fetch('PUT', `/types/${id}/schema`, schema),
    };
  }

  // ─── Breadcrumb / history ────────────────────────────────────────────────────

  get breadcrumb() {
    const c = this;
    return {
      getClipboard: () => c._fetch('GET', '/breadcrumb/clipboard'),
      addClipboard: (payload) => c._fetch('POST', '/breadcrumb/clipboard', payload),
      getViewed: () => c._fetch('GET', '/breadcrumb/viewed'),
      addViewed: (payload) => c._fetch('POST', '/breadcrumb/viewed', payload),
    };
  }

  // ─── Studio ──────────────────────────────────────────────────────────────────

  get studio() {
    const c = this;
    return {
      getStarred: () => c._fetch('GET', '/app/studio/starred'),
      addStarred: (payload) => c._fetch('POST', '/app/studio/starred', payload),
      removeStarred: (id) => c._fetch('DELETE', `/app/studio/starred/${id}`),
      getView: (id) => c._fetch('GET', `/app/studio/view/${id}`),
      saveView: (id, payload) => c._fetch('PUT', `/app/studio/view/${id}`, payload),
      getSyncSystemItems: () => c._fetch('GET', '/app/studio/sync-system-items'),
      importSystemItems: (folderIds) =>
        c._fetch('POST', '/app/studio/sync-system-items/import', { folderIds }),
      exportSystemItems: (typeIds) =>
        c._fetch('POST', '/app/studio/sync-system-items/export', { typeIds }),
      getSettings: () => c._fetch('GET', '/app/studio/settings'),
      saveSettings: (payload) => c._fetch('POST', '/app/studio/settings', payload),
      getLayouts: () => c._fetch('GET', '/app/studio/layouts'),
      saveLayouts: (payload) => c._fetch('PUT', '/app/studio/layouts', payload),
    };
  }

  // ─── Skills ──────────────────────────────────────────────────────────────────

  get skills() {
    const c = this;
    return {
      list: () => c._fetch('GET', '/skills'),
      get: (id) => c._fetch('GET', `/skills/${id}`),
      update: (id, content) => c._fetch('PUT', `/skills/${id}`, { content }),
    };
  }

  // ─── Indexes ─────────────────────────────────────────────────────────────────

  rebuildIndexes() {
    return this._fetch('POST', '/rebuild-indexes', {});
  }

  // ─── Claude sessions ─────────────────────────────────────────────────────────

  get claude() {
    const c = this;
    return {
      createSession: (prompt, workingDir) =>
        c._fetch('POST', '/claude/sessions', { prompt, workingDir }),
      // Returns a raw fetch Response with an event-stream body
      streamSession: (id) => {
        const headers = { Accept: 'text/event-stream' };
        if (c._token) headers['Authorization'] = `Bearer ${c._token}`;
        return fetch(`${c._base}/claude/sessions/${id}/stream`, { headers });
      },
      respond: (id, approved) =>
        c._fetch('POST', `/claude/sessions/${id}/respond`, { approved }),
      cancelSession: (id) => c._fetch('DELETE', `/claude/sessions/${id}`),
    };
  }
}

/**
 * Create a Kanecta API client.
 *
 * Reads KANECTA_API_URL (default http://localhost:3001) and KANECTA_TOKEN
 * from the environment unless overridden via options.
 */
function createApiClient(options = {}) {
  const baseUrl = options.baseUrl ?? process.env.KANECTA_API_URL ?? 'http://localhost:3001';
  const token = options.token ?? process.env.KANECTA_TOKEN;
  return new KanectaApiClient(baseUrl, token);
}

module.exports = { createApiClient, KanectaApiClient };
