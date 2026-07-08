import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['1.4.0/kanecta-schema-validator/**/*.test.ts'],
  },
});
