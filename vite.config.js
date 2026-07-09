import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true
      },
      '/api-yahoo': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api-yahoo/, ''),
        headers: {
          'Referer': 'https://finance.yahoo.com',
          'Origin': 'https://finance.yahoo.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      },
      '/api-hyperliquid': {
        target: 'https://api.hyperliquid.xyz',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api-hyperliquid/, '')
      },
      '/ws-hyperliquid': {
        target: 'https://api.hyperliquid.xyz',
        ws: true,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/ws-hyperliquid/, '')
      }
    }
  }
});
