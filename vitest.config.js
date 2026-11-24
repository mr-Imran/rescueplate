import { defineConfig } from 'vitest/config';

// Server tests run against a real PostgreSQL (started by test/globalSetup.js),
// one file at a time because they share that database.
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    globalSetup: ['test/globalSetup.js'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DEMO_MODE: 'true',
      DEMO_PASSWORD: 'test-only-password',
      DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:54330/rescueplate_test',
    },
  },
});
