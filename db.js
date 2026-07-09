import dotenv from 'dotenv';
import pg from 'pg';

// Load environment variables from .env
dotenv.config();

const { Pool } = pg;

// TODO(security): In production, avoid using the default superuser account. Use a dedicated 
// user with restricted permissions (SELECT, INSERT, UPDATE) on the trading_accounts table only.
// TODO(security): In production, configure mTLS (SSL/TLS client certificates) for securing database connections.
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 5000, // fail fast instead of hanging requests
    })
  : new Pool({
      user: process.env.DB_USER || 'postgres',
      host: process.env.DB_HOST || '127.0.0.1',
      database: process.env.DB_NAME || 'bitrow_db',
      // pg requires string password — undefined causes SASL auth crash
      password: process.env.DB_PASSWORD !== undefined ? String(process.env.DB_PASSWORD) : '',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      connectionTimeoutMillis: 5000, // fail fast instead of hanging requests
    });

// Warn on startup if no password is configured
if (!process.env.DATABASE_URL && !process.env.DB_PASSWORD) {
  console.warn('[DB] Warning: DB_PASSWORD is not set. Set it in your .env file to connect to PostgreSQL.');
}

// Log any unexpected pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err.message);
});

/**
 * Parameterized query helper to prevent SQL injections.
 * @param {string} text - SQL query string with placeholders (e.g. $1, $2)
 * @param {Array} params - Bind parameters
 */
export const query = (text, params) => pool.query(text, params);
export { pool };
