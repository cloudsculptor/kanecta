// Moved to the shared @kanecta/embeddings package so every storage adapter
// (postgres, sqlite-fs, …) uses the same provider abstraction. Re-exported
// here so existing `../src/embeddings` imports keep working.
export {
  EmbeddingProvider,
  MockEmbeddingProvider,
  VoyageEmbeddingProvider,
  createEmbeddingProvider,
  reciprocalRankFusion,
} from '@kanecta/embeddings';
