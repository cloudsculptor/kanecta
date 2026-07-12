import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude],
    // Tests create throwaway schemas and must apply migrations + seed built-in
    // types; opt into the fail-closed schema-change guard for the whole suite.
    env: { KANECTA_ALLOW_SCHEMA_CHANGES: '1' },
  },
});
