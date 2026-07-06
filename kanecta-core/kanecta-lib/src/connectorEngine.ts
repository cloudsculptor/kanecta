'use strict';

// ConnectorEngine — orchestrates stub materialization, scheduled refresh,
// and write-back for connector-managed items.
//
// Usage:
//   const engine = new ConnectorEngine(adapter, runOperation);
//   await engine.getOrMaterialize(itemId);
//   await engine.refreshStaleItems({ beforeAt: new Date().toISOString() });
//   await engine.queueWriteBack(itemId);
//
// runOperation(operationRef, params) — async function that executes a connector
// operation (a function or pipeline item) and returns the result payload.
//   operationRef = { type: 'function' | 'pipeline', id: '<uuid>' }
//   params = { connectorId, externalId?, baseUrl, auth, syncScope? }
//
// The engine is adapter-agnostic: it works with any adapter that implements
// get(), update(), readObjectJson(), writeObjectJson(), listStubs(), and
// listDueForRefresh(). SQLite (sync) and Postgres (async) are both supported
// because all engine calls use await, which is a no-op on sync return values.

class ConnectorEngine {
  constructor(adapter, runOperation) {
    this._adapter = adapter;
    this._runOperation = runOperation;
  }

  // ─── Internal helpers ────────────────────────────────────────────────────────

  // Load a connector item and return its objectData (connectorPayload).
  async _loadConnector(connectorId) {
    const item = await this._adapter.get(connectorId);
    if (!item) throw new Error(`Connector item not found: ${connectorId}`);
    const payload = await this._adapter.readObjectJson(connectorId);
    if (!payload) throw new Error(`Connector payload missing on item: ${connectorId}`);
    return payload;
  }

  // Resolve an authConfigRef to a credentials value.
  // $VAR_NAME  → process.env.VAR_NAME (returns the value or null)
  // $SECRET:…  → throws (secret-manager references not yet supported in 1.4.0)
  // other      → returned as-is (allows string literals in tests / simple setups)
  _resolveAuth(connector) {
    const ref = connector.authConfigRef;
    if (!ref) return null;
    if (typeof ref === 'string' && ref.startsWith('$SECRET:')) {
      throw new Error(`Secret manager references not yet supported: ${ref}`);
    }
    if (typeof ref === 'string' && ref.startsWith('$')) {
      return process.env[ref.slice(1)] ?? null;
    }
    return ref;
  }

  // Validate that an operation reference is well-formed.
  _validateOperation(op, name) {
    if (!op) throw new Error(`Connector is missing required operation: ${name}`);
    if (!op.type || !['function', 'pipeline'].includes(op.type)) {
      throw new Error(`Connector operation "${name}" has invalid type: "${op.type}". Must be "function" or "pipeline".`);
    }
    if (!op.id) throw new Error(`Connector operation "${name}" is missing an id`);
  }

  // ─── Core operations ─────────────────────────────────────────────────────────

  // Materialize a stub item by invoking the connector's fetch operation.
  // The item must be a stub: materialized === false and connectorId set.
  // On success: objectData is written, materialized → true, cachedAt → now.
  // Returns the updated item shape (without re-fetching from the adapter).
  async materializeStub(itemId) {
    const item = await this._adapter.get(itemId);
    if (!item) throw new Error(`Item not found: ${itemId}`);
    if (item.materialized !== false) {
      throw new Error(`Item ${itemId} is not a stub (materialized=${item.materialized})`);
    }
    if (!item.connectorId) {
      throw new Error(`Item ${itemId} has no connectorId — cannot materialize`);
    }

    const connector = await this._loadConnector(item.connectorId);
    this._validateOperation(connector.fetch, 'fetch');
    const auth = this._resolveAuth(connector);

    const payload = await this._runOperation(connector.fetch, {
      connectorId: item.connectorId,
      externalId: item.sourceExternalId,
      baseUrl: connector.baseUrl,
      auth,
    });

    const now = new Date().toISOString();
    await this._adapter.writeObjectJson(itemId, payload);
    await this._adapter.update(itemId, { materialized: true, cachedAt: now });

    return { ...item, objectData: payload, materialized: true, cachedAt: now };
  }

  // Get an item, automatically materializing it if it is a stub.
  // Returns null if the item does not exist.
  async getOrMaterialize(itemId) {
    const item = await this._adapter.get(itemId);
    if (!item) return null;
    if (item.materialized === false && item.connectorId) {
      return this.materializeStub(itemId);
    }
    return item;
  }

  // Re-fetch a connector-managed item (already materialized or stub) by
  // invoking the connector's fetch operation and updating objectData + cachedAt.
  async _refreshItem(item) {
    if (!item.connectorId) throw new Error(`Item ${item.id} has no connectorId`);
    const connector = await this._loadConnector(item.connectorId);
    this._validateOperation(connector.fetch, 'fetch');
    const auth = this._resolveAuth(connector);

    const payload = await this._runOperation(connector.fetch, {
      connectorId: item.connectorId,
      externalId: item.sourceExternalId,
      baseUrl: connector.baseUrl,
      auth,
    });

    const now = new Date().toISOString();
    await this._adapter.writeObjectJson(item.id, payload);
    await this._adapter.update(item.id, { materialized: true, cachedAt: now });
  }

  // Refresh all connector-managed items whose cachedAt is before beforeAt.
  // Failures are non-fatal: logged as warnings, counted in result.
  // Returns { refreshed, failed }.
  async refreshStaleItems({ beforeAt = new Date().toISOString() } = {}) {
    const stale = await this._adapter.listDueForRefresh(beforeAt);
    let refreshed = 0;
    let failed = 0;
    for (const item of stale) {
      try {
        await this._refreshItem(item);
        refreshed++;
      } catch (err) {
        failed++;
        console.warn(`[ConnectorEngine] Failed to refresh ${item.id}: ${err.message}`);
      }
    }
    return { refreshed, failed };
  }

  // Queue and immediately execute a write-back for a connector-managed item.
  // No-ops (returns false) when the item has no connector or writeBack is disabled.
  // Throws if writeBack is true but no push operation is configured.
  // On success updates cachedAt and returns true.
  async queueWriteBack(itemId) {
    const item = await this._adapter.get(itemId);
    if (!item?.connectorId) return false;

    const connector = await this._loadConnector(item.connectorId);
    if (!connector.writeBack) return false;
    if (!connector.push) {
      throw new Error(`Connector ${item.connectorId} has writeBack: true but no push operation configured`);
    }

    this._validateOperation(connector.push, 'push');
    const auth = this._resolveAuth(connector);

    await this._runOperation(connector.push, {
      connectorId: item.connectorId,
      externalId: item.sourceExternalId,
      item,
      baseUrl: connector.baseUrl,
      auth,
    });

    await this._adapter.update(itemId, { cachedAt: new Date().toISOString() });
    return true;
  }

  // List all stub items managed by the given connector.
  async listStubs(connectorId) {
    return this._adapter.listStubs(connectorId);
  }
}

module.exports = { ConnectorEngine };
