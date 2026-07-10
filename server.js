import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { query } from './db.js';
import crypto from 'crypto';
import fs from 'fs';
import { ethers } from 'ethers';
// ES Module setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Note: express.json() must come AFTER the proxy middleware, otherwise POST proxies will hang (504 Gateway Timeout)

app.use((req, res, next) => {
  const originalEnd = res.end;
  res.end = function(...args) {
    console.log(`[Response] ${req.method} ${req.url} -> ${res.statusCode}`);
    originalEnd.apply(this, args);
  };
  console.log(`[Request] ${req.method} ${req.url} - Cookie:`, req.headers.cookie ? 'present' : 'none');
  next();
});

const PORT = process.env.PORT || 3000;

// --- 1. YAHOO FINANCE PROXY ---
app.use('/api-yahoo', createProxyMiddleware({
  target: 'https://query1.finance.yahoo.com',
  changeOrigin: true,
  secure: false, // SSL/TLS errors rokne ke liye
  pathRewrite: { '^/api-yahoo': '' },
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Origin': 'https://finance.yahoo.com',
    'Referer': 'https://finance.yahoo.com',
    'Connection': 'close'
  }
}));

// --- 2. HYPERLIQUID API PROXY ---
app.use('/api-hyperliquid', createProxyMiddleware({
  target: 'https://api.hyperliquid.xyz',
  changeOrigin: true,
  secure: false,
  pathRewrite: { '^/api-hyperliquid': '' },
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Origin': 'https://app.hyperliquid.xyz',
    'Connection': 'close'
  }
}));

// --- 3. HYPERLIQUID WEBSOCKET PROXY (FIXED) ---
const wsProxy = createProxyMiddleware({
  target: 'https://api.hyperliquid.xyz',
  ws: true,
  changeOrigin: true,
  secure: false,
  pathRewrite: { '^/ws-hyperliquid': '' },
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Origin': 'https://app.hyperliquid.xyz',
    'Connection': 'close'
  }
});
app.use('/ws-hyperliquid', wsProxy);

// --- POST-PROXY MIDDLEWARE ---
app.use(express.json()); // Enable JSON body parsing for API requests

// --- JWT & SESSION AUTHENTICATION ---
function getSecret() {
  if (process.env.JWT_SECRET_KEY) return process.env.JWT_SECRET_KEY;
  if (fs.existsSync('./jwt_secret.txt')) return fs.readFileSync('./jwt_secret.txt', 'utf-8').trim();
  console.warn("Generating ephemeral secret. Instance-isolated!");
  const ephemeralSecret = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync('./jwt_secret.txt', ephemeralSecret);
  } catch (e) {
    // Ignore write errors in read-only filesystems
  }
  return ephemeralSecret;
}
const JWT_SECRET = getSecret();

function signToken(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret)
    .update(`${base64Header}.${base64Payload}`)
    .digest('base64url');
  return `${base64Header}.${base64Payload}.${signature}`;
}

function verifyToken(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [base64Header, base64Payload, signature] = parts;
  const expectedSignature = crypto.createHmac('sha256', secret)
    .update(`${base64Header}.${base64Payload}`)
    .digest('base64url');
  if (signature !== expectedSignature) return null;
  
  try {
    const payload = JSON.parse(Buffer.from(base64Payload, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// Session parser helper
function getSessionToken(req) {
  const cookies = {};
  if (req.headers.cookie) {
    req.headers.cookie.split(';').forEach(c => {
      const parts = c.split('=');
      if (parts.length >= 2) {
        cookies[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('='));
      }
    });
  }
  return cookies['bitrow-session'] || null;
}

// Session authentication middleware
function authenticateSession(req, res, next) {
  const token = getSessionToken(req);
  if (!token) {
    return res.status(401).json({ error: 'No active session. Please log in.' });
  }
  const verified = verifyToken(token, JWT_SECRET);
  if (!verified) {
    return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }
  req.user = verified;
  next();
}

  // Auth Router Endpoints



app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ error: 'Missing credential token' });
  }
  
  try {
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
    if (!response.ok) {
      return res.status(401).json({ error: 'Failed to verify Google token' });
    }
    const googleUser = await response.json();
    
    // Check required fields
    if (!googleUser.email) {
      return res.status(400).json({ error: 'Email missing from Google token' });
    }

    // Verify audience matches our Client ID
    const expectedClientId = process.env.GOOGLE_CLIENT_ID || '190383912136-u78g0vl8jdd1lavpbo693gspiii3sfq9.apps.googleusercontent.com';
    if (googleUser.aud !== expectedClientId) {
      return res.status(401).json({ error: 'Google token was not generated for this application' });
    }
    
    const payload = {
      accountId: googleUser.email,
      email: googleUser.email,
      name: googleUser.name || googleUser.email.split('@')[0],
      picture: googleUser.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(googleUser.name || '')}&background=random&color=fff`,
      exp: Date.now() + 30 * 24 * 60 * 60 * 1000
    };
    const token = signToken(payload, JWT_SECRET);
    
    res.cookie('bitrow-session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
    res.json({ success: true, accountId: googleUser.email, email: googleUser.email, name: payload.name, picture: payload.picture });
  } catch (err) {
    console.error('Google token verification failed:', err.message);
    res.status(500).json({ error: 'Token verification failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('bitrow-session');
  res.json({ success: true });
});

app.get('/api/auth/session', authenticateSession, (req, res) => {
  res.json({
    success: true,
    accountId: req.user.accountId,
    email: req.user.email,
    name: req.user.name,
    picture: req.user.picture,
    isGuest: req.user.isGuest
  });
});

// --- 3.5. DATABASE STATE SYNC API ---
app.get('/api/account/:id', authenticateSession, async (req, res) => {
  const accountId = req.params.id;
  // TODO(security): Validate path parameters to prevent path traversal/tampering if we do file operations.
  // Validate that the accountId has a simple alphanumeric format.
  if (!accountId || !/^[a-zA-Z0-9 #_@.-]+$/.test(accountId)) {
    return res.status(400).json({ error: 'Invalid account ID format' });
  }

  // Verify BOLA: user can only access their own account
  if (req.user.accountId !== accountId) {
    return res.status(403).json({ error: 'Forbidden: You do not have access to this account ID' });
  }

  try {
    const result = await query('SELECT * FROM trading_accounts WHERE account_id = $1', [accountId]);
    if (result.rows.length > 0) {
      const row = result.rows[0];
      res.json({
        accountId: row.account_id,
        balance: parseFloat(row.balance),
        positions: row.positions,
        pendingOrders: row.pending_orders,
        history: row.history
      });
    } else {
      // Return default values; the client will save this default state to the DB when it initializes.
      res.json({
        accountId,
        balance: 10000.00,
        positions: [],
        pendingOrders: [],
        history: []
      });
    }
  } catch (err) {
    // TODO(security): Log detailed error internally, but do not expose SQL details in the response.
    console.error('Failed to load trading account from DB:', err.message);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// --- 3.5.5 WEB3 WALLET INFO API ---
app.get('/api/wallet/address', authenticateSession, (req, res) => {
  const address = process.env.RECEIVING_WALLET_ADDRESS;
  if (!address) {
    return res.status(500).json({ error: 'Admin wallet address not configured' });
  }
  res.json({ address });
});

// --- 3.6. WEB3 CRYPTO DEPOSIT API ---
app.post('/api/wallet/deposit', authenticateSession, async (req, res) => {
  const { txHash } = req.body;
  if (!txHash || typeof txHash !== 'string' || !txHash.startsWith('0x')) {
    return res.status(400).json({ error: 'Invalid transaction hash' });
  }

  const receivingWallet = process.env.RECEIVING_WALLET_ADDRESS;
  if (!receivingWallet) {
    return res.status(500).json({ error: 'RECEIVING_WALLET_ADDRESS is not configured in .env' });
  }

  try {
    // 1. Check for replay attacks in database
    const existingTx = await query('SELECT * FROM crypto_deposits WHERE tx_hash = $1', [txHash]);
    if (existingTx.rows.length > 0) {
      return res.status(400).json({ error: 'This deposit transaction has already been processed' });
    }

    // 2. Query blockchain
    const provider = new ethers.JsonRpcProvider('https://polygon-rpc.com');
    const tx = await provider.getTransaction(txHash);
    
    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found on the network. Wait for confirmations.' });
    }

    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) {
      return res.status(400).json({ error: 'Transaction failed or is still pending.' });
    }

    // 3. Verify destination
    if (tx.to.toLowerCase() !== receivingWallet.toLowerCase()) {
      return res.status(400).json({ error: 'Transaction was not sent to the correct admin wallet' });
    }

    // 4. Calculate amount in USD
    const amountMatic = parseFloat(ethers.formatEther(tx.value));
    if (amountMatic <= 0) {
      return res.status(400).json({ error: 'Zero value transaction' });
    }

    // Fetch MATIC/POL price from Binance
    const priceRes = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=POLUSDT').catch(() => null);
    let maticPriceUsd = 0.5; // fallback
    if (priceRes && priceRes.ok) {
      const priceData = await priceRes.json();
      maticPriceUsd = parseFloat(priceData.price);
    }
    const amountUsd = amountMatic * maticPriceUsd;

    // 5. Update user's balance and record transaction in DB
    await query('BEGIN');
    
    await query(
      'INSERT INTO crypto_deposits (tx_hash, account_id, amount_usd) VALUES ($1, $2, $3)', 
      [txHash, req.user.accountId, amountUsd]
    );
    
    await query(
      'UPDATE trading_accounts SET balance = balance + $1 WHERE account_id = $2',
      [amountUsd, req.user.accountId]
    );
    
    await query('COMMIT');

    res.json({ success: true, amountUsd, amountMatic });
  } catch (err) {
    await query('ROLLBACK').catch(() => {});
    console.error('Wallet deposit error:', err);
    res.status(500).json({ error: 'Internal server error while verifying deposit' });
  }
});

// --- 3.7. WEB3 CRYPTO WITHDRAW API ---
app.post('/api/wallet/withdraw', authenticateSession, async (req, res) => {
  const { walletAddress, amountUsd } = req.body;
  if (!walletAddress || typeof walletAddress !== 'string' || !walletAddress.startsWith('0x')) {
    return res.status(400).json({ error: 'Invalid Polygon wallet address' });
  }
  if (!amountUsd || isNaN(amountUsd) || parseFloat(amountUsd) <= 0) {
    return res.status(400).json({ error: 'Invalid withdrawal amount' });
  }

  const amount = parseFloat(amountUsd);

  try {
    await query('BEGIN');
    
    // Check balance
    const accountRes = await query('SELECT balance FROM trading_accounts WHERE account_id = $1 FOR UPDATE', [req.user.accountId]);
    if (accountRes.rows.length === 0) {
      await query('ROLLBACK');
      return res.status(404).json({ error: 'Trading account not found' });
    }
    
    const currentBalance = parseFloat(accountRes.rows[0].balance);
    if (currentBalance < amount) {
      await query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Deduct balance
    await query('UPDATE trading_accounts SET balance = balance - $1 WHERE account_id = $2', [amount, req.user.accountId]);
    
    // Record withdrawal request
    await query(
      'INSERT INTO crypto_withdrawals (account_id, wallet_address, amount_usd, status) VALUES ($1, $2, $3, $4)',
      [req.user.accountId, walletAddress, amount, 'pending']
    );

    await query('COMMIT');
    res.json({ success: true, message: 'Withdrawal request submitted successfully' });
  } catch (err) {
    await query('ROLLBACK').catch(() => {});
    console.error('Wallet withdraw error:', err);
    res.status(500).json({ error: 'Internal server error while processing withdrawal' });
  }
});

// --- ADMIN MIDDLEWARE ---
function authenticateAdmin(req, res, next) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || req.user.email !== adminEmail) {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }
  next();
}

// --- 4. ADMIN API ENDPOINTS ---
app.get('/api/admin/stats', authenticateSession, authenticateAdmin, async (req, res) => {
  try {
    const usersRes = await query('SELECT COUNT(*) as total_users FROM trading_accounts');
    const balanceRes = await query('SELECT SUM(balance) as total_balance FROM trading_accounts');
    const withdrawalsRes = await query('SELECT * FROM crypto_withdrawals ORDER BY created_at DESC');
    const depositsRes = await query('SELECT COUNT(*) as total_deposits, SUM(amount_usd) as total_deposit_amount FROM crypto_deposits');

    res.json({
      totalUsers: parseInt(usersRes.rows[0].total_users || 0),
      totalBalance: parseFloat(balanceRes.rows[0].total_balance || 0),
      totalDeposits: parseInt(depositsRes.rows[0].total_deposits || 0),
      totalDepositAmount: parseFloat(depositsRes.rows[0].total_deposit_amount || 0),
      withdrawals: withdrawalsRes.rows
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Failed to fetch admin stats' });
  }
});

app.post('/api/admin/withdrawals/:id/approve', authenticateSession, authenticateAdmin, async (req, res) => {
  try {
    await query('UPDATE crypto_withdrawals SET status = $1 WHERE id = $2', ['approved', req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve withdrawal' });
  }
});

app.post('/api/admin/withdrawals/:id/reject', authenticateSession, authenticateAdmin, async (req, res) => {
  try {
    await query('BEGIN');
    const wRes = await query('SELECT * FROM crypto_withdrawals WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (wRes.rows.length === 0 || wRes.rows[0].status !== 'pending') {
      await query('ROLLBACK');
      return res.status(400).json({ error: 'Withdrawal not found or already processed' });
    }
    const withdrawal = wRes.rows[0];
    
    // Refund balance
    await query('UPDATE trading_accounts SET balance = balance + $1 WHERE account_id = $2', [withdrawal.amount_usd, withdrawal.account_id]);
    await query('UPDATE crypto_withdrawals SET status = $1 WHERE id = $2', ['rejected', req.params.id]);
    
    await query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: 'Failed to reject withdrawal' });
  }
});

app.post('/api/account/save', authenticateSession, async (req, res) => {
  const { accountId, balance, positions, pendingOrders, history } = req.body;

  if (!accountId || !/^[a-zA-Z0-9 #_@.-]+$/.test(accountId)) {
    return res.status(400).json({ error: 'Invalid or missing account ID' });
  }

  // Verify BOLA: user can only save their own account
  if (req.user.accountId !== accountId) {
    return res.status(403).json({ error: 'Forbidden: You do not have access to this account ID' });
  }

  try {
    // Using parameterized upsert to prevent SQL injection and handle concurrent updates safely
    await query(
      `INSERT INTO trading_accounts (account_id, balance, positions, pending_orders, history)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (account_id) DO UPDATE
       SET balance = $2, positions = $3, pending_orders = $4, history = $5, updated_at = CURRENT_TIMESTAMP`,
      [
        accountId,
        parseFloat(balance) || 10000.00,
        JSON.stringify(positions || []),
        JSON.stringify(pendingOrders || []),
        JSON.stringify(history || [])
      ]
    );
    res.json({ success: true });
  } catch (err) {
    // TODO(security): Log detailed error internally, do not expose SQL queries to external client.
    console.error('Failed to save trading account to DB:', err.message);
    res.status(500).json({ error: 'Database save failed' });
  }
});

// --- 4. FRONTEND SERVE ---
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

async function initDatabase() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS trading_accounts (
        account_id VARCHAR(255) PRIMARY KEY,
        balance DECIMAL(15, 2) DEFAULT 10000.00,
        positions JSONB DEFAULT '[]'::jsonb,
        pending_orders JSONB DEFAULT '[]'::jsonb,
        history JSONB DEFAULT '[]'::jsonb,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS crypto_deposits (
        tx_hash VARCHAR(255) PRIMARY KEY,
        account_id VARCHAR(255),
        amount_usd DECIMAL(15, 2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS crypto_withdrawals (
        id SERIAL PRIMARY KEY,
        account_id VARCHAR(255),
        wallet_address VARCHAR(255),
        amount_usd DECIMAL(15, 2),
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Database tables verified/created successfully.');
  } catch (err) {
    console.error('Failed to initialize database tables:', err.message);
  }
}

// --- 5. START SERVER ---
const server = app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  await initDatabase();
});

// Yeh line server crash hone se rokegi aur WebSockets ko sahi se chalayegi
server.on('upgrade', wsProxy.upgrade);
