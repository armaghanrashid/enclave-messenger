import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  optimizeDeps: {
    // the Rust crypto WASM package must not be pre-bundled
    exclude: ['@matrix-org/matrix-sdk-crypto-wasm'],
  },
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
