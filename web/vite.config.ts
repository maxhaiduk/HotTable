import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `npm run dev` serves the UI with hot reload and sends the API to labd (make ui).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // One bundle is fine: labd serves it from localhost.
  build: { chunkSizeWarningLimit: 1500 },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:7070',
      '/ws': { target: 'ws://127.0.0.1:7070', ws: true },
    },
  },
})
