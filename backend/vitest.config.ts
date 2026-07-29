import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Unit tests here cover pure domain logic only — no database, no HTTP.
    // Integration tests that need Postgres live behind `npm run test:integration`
    // and are documented in the README's Known Limitations.
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/utils/**', 'src/services/**'],
      reporter: ['text', 'lcov'],
    },
  },
});
