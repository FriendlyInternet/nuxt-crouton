import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The tests run the real server route handlers, as bookings' do.
    environment: 'node',
    globals: true
  }
})
