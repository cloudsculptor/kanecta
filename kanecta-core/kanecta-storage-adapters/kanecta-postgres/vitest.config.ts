import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // TODO(ts-migration): sync.integration.test.ts imports @kanecta/sqlite-fs
    // *source* cross-package; vitest 4 externalises the symlinked workspace dep
    // and cannot resolve its extensionless .ts internals. Re-enable once the
    // monorepo-wide vitest source-resolution is set up. Tracked in
    // ts-migration-execution-plan.md.
    exclude: [...configDefaults.exclude, '**/sync.integration.test.ts'],
  },
});
