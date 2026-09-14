import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Ensure a single React copy across app code, recharts, and tests.
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'packages/*/test/**/*.test.tsx'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
