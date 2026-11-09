import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: { index: resolve(import.meta.dirname, 'index.html'), capture: resolve(import.meta.dirname, 'src/core/capture.ts') },
      output: {
        entryFileNames: chunk => chunk.name === 'capture' ? 'capture.mjs' : 'assets/[name]-[hash].js',
      },
      preserveEntrySignatures: 'strict',
    },
  },
})
