import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Client } = pg;

async function main() {
  const client = new Client({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || '127.0.0.1',
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'bitrow_db'
  });

  try {
    await client.connect();
    const res = await client.query('SELECT account_id, balance, created_at, updated_at FROM trading_accounts;');
    
    if (res.rows.length === 0) {
      console.log('No user accounts found in the database yet. Open the web terminal in the browser first to create one!');
    } else {
      console.log('\n--- User Account Details in PostgreSQL ---');
      console.table(res.rows.map(row => ({
        'Account ID': row.account_id,
        'Balance ($)': parseFloat(row.balance).toFixed(2),
        'Created At': new Date(row.created_at).toLocaleString(),
        'Last Updated': new Date(row.updated_at).toLocaleString()
      })));
      
      // Also show details of the first user's positions & history if any
      const fullRes = await client.query('SELECT * FROM trading_accounts LIMIT 1;');
      if (fullRes.rows.length > 0) {
        const user = fullRes.rows[0];
        console.log(`\nDetailed state for Account: ${user.account_id}`);
        console.log(`- Open Positions:`, JSON.stringify(user.positions, null, 2));
        console.log(`- Pending Orders:`, JSON.stringify(user.pending_orders, null, 2));
        console.log(`- Trade History:`, JSON.stringify(user.history, null, 2));
      }
    }
  } catch (err) {
    console.error('Error reading from database:', err.message);
  } finally {
    await client.end();
  }
}

main();
