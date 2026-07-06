'use strict';

// Generic embedding-provider abstraction for semantic search.
//
// A provider just needs `name`, `model`, `dimensions`, and an async `embed`
// that turns strings into vectors. This keeps the adapter and migrations
// independent of any one vendor — Anthropic has no embeddings endpoint of its
// own (Claude is chat-only), so this is built to plug in whichever provider
// you actually have a key for (Voyage AI is the Anthropic-recommended one).
//
// Config shape (workspace `cloud.embeddings` block in ~/.config/kanecta/config.json):
//   { provider: 'voyage', apiKey: '...', model: 'voyage-3-lite', dimensions: 1024 }
//   { provider: 'mock' }   — deterministic fake vectors, used in tests

class EmbeddingProvider {
  constructor({ name, model, dimensions }) {
    this.name = name;
    this.model = model;
    this.dimensions = dimensions;
  }

  // async embed(texts: string[]): Promise<number[][]>
  async embed(_texts) {
    throw new Error(`${this.name} provider does not implement embed()`);
  }
}

// Deterministic, dependency-free fake embeddings — same input always produces
// the same vector, and similar strings produce similar vectors (it hashes
// overlapping word shingles into buckets), so ranking-by-cosine-distance
// behaves sensibly enough to exercise semantic/hybrid search in tests without
// a real provider or network access.
class MockEmbeddingProvider extends EmbeddingProvider {
  constructor({ model = 'mock-embed', dimensions = 32 } = {}) {
    super({ name: 'mock', model, dimensions });
  }

  async embed(texts) {
    return texts.map(text => this._vector(text));
  }

  _vector(text) {
    const v = new Array(this.dimensions).fill(0);
    const words = String(text ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const word of words) {
      const bucket = hashString(word) % this.dimensions;
      v[bucket] += 1;
    }
    const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0)) || 1;
    return v.map(x => x / norm);
  }
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Calls Voyage AI's embeddings endpoint (https://docs.voyageai.com/reference/embeddings-api) —
// Anthropic's recommended embeddings partner. Needs `apiKey`; `model` defaults
// to their smallest general-purpose model.
class VoyageEmbeddingProvider extends EmbeddingProvider {
  constructor({ apiKey, model = 'voyage-3-lite', dimensions = 1024, endpoint = 'https://api.voyageai.com/v1/embeddings' } = {}) {
    super({ name: 'voyage', model, dimensions });
    if (!apiKey) throw new Error('Voyage embedding provider requires an apiKey');
    this._apiKey = apiKey;
    this._endpoint = endpoint;
  }

  async embed(texts) {
    const res = await fetch(this._endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this._apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: texts, model: this.model }),
    });
    if (!res.ok) {
      throw new Error(`Voyage embeddings request failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    return body.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding);
  }
}

// Builds a provider from the workspace's `cloud.embeddings` config. Returns null when
// embeddings aren't configured — callers should treat semantic/hybrid search
// as unavailable in that case (FTS keeps working regardless).
function createEmbeddingProvider(config) {
  if (!config || !config.provider) return null;
  switch (config.provider) {
    case 'mock':   return new MockEmbeddingProvider(config);
    case 'voyage': return new VoyageEmbeddingProvider(config);
    default:
      throw new Error(`Unknown embedding provider: '${config.provider}' (expected 'voyage' or 'mock')`);
  }
}

// Reciprocal Rank Fusion — merges multiple ranked result lists into one,
// rewarding items that rank highly across several lists. `k` dampens the
// weight of low ranks (60 is the value used in the original RRF paper and
// most production hybrid-search implementations).
function reciprocalRankFusion(resultLists, { k = 60 } = {}) {
  const scored = new Map();
  for (const list of resultLists) {
    list.forEach((item, rank) => {
      const entry = scored.get(item.id) ?? { item, score: 0 };
      entry.score += 1 / (k + rank + 1);
      scored.set(item.id, entry);
    });
  }
  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}

module.exports = {
  EmbeddingProvider,
  MockEmbeddingProvider,
  VoyageEmbeddingProvider,
  createEmbeddingProvider,
  reciprocalRankFusion,
};
