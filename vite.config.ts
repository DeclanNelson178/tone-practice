import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  // GitHub Pages serves a project site from /<repo>/, so every production build targets
  // that path. Keyed on `mode` rather than `command` so `vite preview` — which is also
  // a "serve" command but runs in production mode — reproduces the deployed paths.
  base: mode === 'production' ? '/tone-practice/' : '/',
  test: {
    globals: true,
    environment: 'node',
    // Only the stats/UI suites need a DOM; they opt in with a per-file
    // `// @vitest-environment jsdom` docblock so the rest stay fast.
    include: ['tests/**/*.test.ts'],
  },
}));
