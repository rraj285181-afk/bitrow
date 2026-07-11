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
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    })
  : new Pool({
      user: process.env.DB_USER || 'postgres',
      host: process.env.DB_HOST || '127.0.0.1',
      database: process.env.DB_NAME || 'bitrow_db',
      password: process.env.DB_PASSWORD,
      port: parseInt(process.env.DB_PORT || '5432', 10),
    });

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
