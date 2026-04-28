'use strict';

const { isValidUuid, generateUuid } = require('./utils');
const {
  readItem,
  writeItem,
  deleteItemDir,
  readConfig,
  walkDataDir,
  readBacklinks,
  addBacklink,
  removeBacklink,
  addToTypeIndex,
  removeFromTypeIndex,
} = require('./datastore');

const LINK_REGEX = /\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]/gi;

function extractLinks(value) {
  if (!value || typeof value !== 'string') return [];
  const links = [];
  let match;
  while ((match = LINK_REGEX.exec(value)) !== null) {
    links.push(match[1]);
  }
  return [...new Set(links)];
}

class KanectaConnector {
  constructor({ datastorePath } = {}) {
    if (!datastorePath) throw new Error('datastorePath is required');
    this.datastorePath = datastorePath;
  }

  async getItem(id) {
    if (!isValidUuid(id)) throw new Error(`Invalid UUID: ${id}`);
    const item = await readItem(this.datastorePath, id);
    if (!item) throw new Error(`Item not found: ${id}`);
    return item;
  }

  async getChildren(parentId) {
    if (parentId !== null && !isValidUuid(parentId)) {
      throw new Error(`Invalid UUID: ${parentId}`);
    }
    const all = await walkDataDir(this.datastorePath);
    const children = all.filter((item) =>
      parentId === null ? item.parentId === null : item.parentId === parentId
    );
    return children.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async listRoots() {
    return this.getChildren(null);
  }

  async getTree(id, { depth = 1 } = {}) {
    const item = await this.getItem(id);
    const all = await walkDataDir(this.datastorePath);
    const byParent = {};
    for (const i of all) {
      const key = i.parentId || '__root__';
      if (!byParent[key]) byParent[key] = [];
      byParent[key].push(i);
    }
    for (const key of Object.keys(byParent)) {
      byParent[key].sort((a, b) => a.sortOrder - b.sortOrder);
    }
    function build(node, remaining) {
      const result = { ...node };
      if (remaining > 0) {
        result.children = (byParent[node.id] || []).map((child) =>
          build(child, remaining - 1)
        );
      }
      return result;
    }
    return build(item, depth - 1);
  }

  async addItem({
    parentId = null,
    value = null,
    type = 'string',
    typeId = null,
    owner,
    sortOrder,
    license = null,
  } = {}) {
    if (parentId !== null && !isValidUuid(parentId)) {
      throw new Error(`Invalid parentId: ${parentId}`);
    }

    const config = await readConfig(this.datastorePath);
    const resolvedOwner = owner || config.owner || 'unknown';

    let resolvedSortOrder = sortOrder;
    if (resolvedSortOrder === undefined) {
      const siblings = await this.getChildren(parentId);
      resolvedSortOrder =
        siblings.length > 0 ? Math.max(...siblings.map((s) => s.sortOrder)) + 1 : 0;
    }

    const id = generateUuid();
    const metadata = {
      id,
      parentId,
      value,
      type,
      typeId: type === 'object' ? typeId : null,
      owner: resolvedOwner,
      license,
      sortOrder: resolvedSortOrder,
      cachedAt: null,
      subscribedAt: null,
      subscriptionSource: null,
    };

    await writeItem(this.datastorePath, metadata);

    if (type === 'object' && typeId && isValidUuid(typeId)) {
      await addToTypeIndex(this.datastorePath, typeId, id);
    }

    const links = extractLinks(value);
    await Promise.all(links.map((targetId) => addBacklink(this.datastorePath, targetId, id)));

    return metadata;
  }

  async updateItem(id, updates = {}) {
    if (!isValidUuid(id)) throw new Error(`Invalid UUID: ${id}`);
    const existing = await readItem(this.datastorePath, id);
    if (!existing) throw new Error(`Item not found: ${id}`);

    const updated = { ...existing, ...updates, id };

    if ('value' in updates && updates.value !== existing.value) {
      const oldLinks = extractLinks(existing.value);
      const newLinks = extractLinks(updates.value);
      await Promise.all([
        ...oldLinks
          .filter((l) => !newLinks.includes(l))
          .map((targetId) => removeBacklink(this.datastorePath, targetId, id)),
        ...newLinks
          .filter((l) => !oldLinks.includes(l))
          .map((targetId) => addBacklink(this.datastorePath, targetId, id)),
      ]);
    }

    if ('type' in updates || 'typeId' in updates) {
      if (existing.type === 'object' && existing.typeId && isValidUuid(existing.typeId)) {
        await removeFromTypeIndex(this.datastorePath, existing.typeId, id);
      }
      if (updated.type === 'object' && updated.typeId && isValidUuid(updated.typeId)) {
        await addToTypeIndex(this.datastorePath, updated.typeId, id);
      }
    }

    await writeItem(this.datastorePath, updated);
    return updated;
  }

  async deleteItem(id, { force = false } = {}) {
    if (!isValidUuid(id)) throw new Error(`Invalid UUID: ${id}`);
    const existing = await readItem(this.datastorePath, id);
    if (!existing) throw new Error(`Item not found: ${id}`);

    const backlinks = await readBacklinks(this.datastorePath, id);
    if (backlinks.length > 0 && !force) {
      throw new Error(
        `Item ${id} has ${backlinks.length} backlink(s). Pass { force: true } to delete anyway.`
      );
    }

    if (existing.type === 'object' && existing.typeId && isValidUuid(existing.typeId)) {
      await removeFromTypeIndex(this.datastorePath, existing.typeId, id);
    }

    const outgoing = extractLinks(existing.value);
    await Promise.all(outgoing.map((targetId) => removeBacklink(this.datastorePath, targetId, id)));

    await deleteItemDir(this.datastorePath, id);
  }

  async moveItem(id, { parentId, sortOrder } = {}) {
    if (!isValidUuid(id)) throw new Error(`Invalid UUID: ${id}`);
    if (parentId !== undefined && parentId !== null && !isValidUuid(parentId)) {
      throw new Error(`Invalid parentId: ${parentId}`);
    }

    const updates = {};
    if (parentId !== undefined) updates.parentId = parentId;

    if (sortOrder !== undefined) {
      updates.sortOrder = sortOrder;
    } else if (parentId !== undefined) {
      const newParentId = parentId !== undefined ? parentId : null;
      const siblings = await this.getChildren(newParentId);
      updates.sortOrder =
        siblings.length > 0 ? Math.max(...siblings.map((s) => s.sortOrder)) + 1 : 0;
    }

    return this.updateItem(id, updates);
  }
}

module.exports = { KanectaConnector };
