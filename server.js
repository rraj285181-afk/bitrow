import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createProxyMiddleware } from 'http-proxy-middleware';

// ES Module setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// --- 1. YAHOO FINANCE PROXY ---
app.use('/api-yahoo', createProxyMiddleware({
  target: 'https://query1.finance.yahoo.com',
  changeOrigin: true,
  secure: false, // SSL/TLS errors rokne ke liye
  pathRewrite: { '^/api-yahoo': '' },
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Origin': 'https://finance.yahoo.com'
  }
}));

// --- 2. HYPERLIQUID API PROXY ---
app.use('/api-hyperliquid', createProxyMiddleware({
  target: 'https://api.hyperliquid.xyz',
  changeOrigin: true,
  secure: false,
  pathRewrite: { '^/api-hyperliquid': '' }
}));

// --- 3. HYPERLIQUID WEBSOCKET PROXY (FIXED) ---
const wsProxy = createProxyMiddleware({
  target: 'https://api.hyperliquid.xyz',
  ws: true,
  changeOrigin: true,
  secure: false,
  pathRewrite: { '^/ws-hyperliquid': '' }
});
app.use('/ws-hyperliquid', wsProxy);

// --- 4. FRONTEND SERVE ---
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// --- 5. START SERVER ---
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Yeh line server crash hone se rokegi aur WebSockets ko sahi se chalayegi
server.on('upgrade', wsProxy.upgrade);
