import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Project pages are served from /<repo>/, so assets must be requested relative to it.
  base: process.env.GITHUB_ACTIONS ? '/tone-practice/' : '/',
  test: {
    globals: true,
    environment: 'node',
    // Only the stats/UI suites need a DOM; they opt in with a per-file
    // `// @vitest-environment jsdom` docblock so the rest stay fast.
    include: ['tests/**/*.test.ts'],
  },
});
