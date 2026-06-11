import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

const studioModules = path.resolve('./node_modules');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Redirect emotion packages to the studio's local copies so that
      // root-hoisted @mui/styled-engine can find them when inlined by Vite.
      '@emotion/styled': `${studioModules}/@emotion/styled`,
      '@emotion/react': `${studioModules}/@emotion/react`,
      '@emotion/cache': `${studioModules}/@emotion/cache`,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    // Force @mui and @emotion through Vite's pipeline so our aliases apply
    // when root-hoisted packages try to import peer deps missing from root.
    server: {
      deps: {
        inline: [/^@mui\//, /^@emotion\//, /^react-transition-group/],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['src/test/**', '**/*.stories.*', 'src/main.tsx'],
    },
  },
});
