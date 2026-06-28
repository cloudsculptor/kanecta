'use strict';

// exportMarkdown — render a document item's target subtree as a Markdown string.
//
// The document item's payload.targetId identifies the subtree root. The role map
// and expand state control which items appear and how they are rendered.
//
// Role precedence (highest to lowest):
//   roleMap.byType[item.typeId]  (UUID key — object items only)
//   roleMap.byType[item.type]    (string key)
//   roleMap.byDepth[depth]       (positional, as string key)
//   'body'                       (fallback)
//
// The 'ignore' role suppresses an item AND all of its descendants.
//
// Expand state:
//   expandState.defaultDepth     — how many levels below targetId to render
//   expandState.exceptions[id]   — integer (override depth for this subtree) or
//                                  false (suppress this item and its descendants)
//
// Depth 0 is targetId itself. Depth 1 is its direct children, and so on.
// Items at depth 0 are rendered only if roleMap.byDepth['0'] is set; the default
// fallback ('body') applies but is usually invisible since the target item is the
// document root, not a body paragraph. Typical usage assigns depth 0 a 'title' role
// or leaves targetId un-rendered by not setting byDepth['0'].

async function exportMarkdown(adapter, documentId) {
  const docItem = await _get(adapter, documentId);
  if (!docItem || docItem.type !== 'document') {
    throw new Error(`Item ${documentId} is not a document`);
  }

  const payload = await _readPayload(adapter, documentId);
  if (!payload?.targetId) {
    throw new Error(`Document ${documentId} has no targetId in payload`);
  }

  const { targetId, roleMap = {}, expandState = {} } = payload;
  const { byDepth = {}, byType = {} } = roleMap;
  const { defaultDepth = Infinity, exceptions = {} } = expandState;

  const lines = [];

  function resolveRole(item, depth) {
    return (item.typeId && byType[item.typeId])
      || byType[item.type]
      || byDepth[String(depth)]
      || 'body';
  }

  async function traverse(itemId, depth, inheritedMaxDepth) {
    // Check if this item is suppressed by an exception
    if (itemId in exceptions && exceptions[itemId] === false) return;

    const item = await _get(adapter, itemId);
    if (!item) return;

    const maxDepth = (itemId in exceptions && exceptions[itemId] !== false)
      ? exceptions[itemId]
      : inheritedMaxDepth;

    // Render this item (skip depth 0 unless explicitly roled)
    if (depth > 0 || byDepth['0']) {
      const role = resolveRole(item, depth);
      if (role === 'ignore') return; // suppress item and all descendants
      const md = _roleToMarkdown(role, item.value ?? '');
      if (md !== null) lines.push(md);
    }

    // Recurse into children if within expand depth
    if (depth < maxDepth) {
      const children = await _children(adapter, itemId);
      for (const child of children) {
        await traverse(child.id, depth + 1, maxDepth);
      }
    }
  }

  await traverse(targetId, 0, defaultDepth);

  return lines.join('\n\n');
}

function _roleToMarkdown(role, text) {
  switch (role) {
    case 'title':      return `# ${text}`;
    case 'heading':    return `## ${text}`;
    case 'subheading': return `### ${text}`;
    case 'body':       return text || null;
    case 'caption':    return `*${text}*`;
    case 'list-item':  return `- ${text}`;
    case 'code-block': return `\`\`\`\n${text}\n\`\`\``;
    case 'ignore':     return null;
    default:           return text || null;
  }
}

// Adapters may be sync (sqlite-fs) or async (Postgres) — normalise with Promise.resolve.

async function _get(adapter, id) {
  return Promise.resolve(adapter.get(id));
}

async function _children(adapter, id) {
  const result = await Promise.resolve(adapter.children(id));
  return result ?? [];
}

async function _readPayload(adapter, id) {
  if (typeof adapter.readDocumentPayload === 'function') {
    return Promise.resolve(adapter.readDocumentPayload(id));
  }
  // Fallback: try readObjectJson for adapters that alias it
  if (typeof adapter.readObjectJson === 'function') {
    return Promise.resolve(adapter.readObjectJson(id));
  }
  return null;
}

module.exports = { exportMarkdown, _roleToMarkdown };
