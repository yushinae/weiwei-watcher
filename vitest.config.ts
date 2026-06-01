import { defineConfig } from 'vitest/config';

// Pure-logic unit tests (no DOM needed). Component/hook tests can switch to jsdom later.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
