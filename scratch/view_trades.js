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
    
    // 1. Get all active positions (BUY/SELL)
    const positionsRes = await client.query(`
      SELECT account_id, 
             pos->>'symbol' as symbol, 
             pos->>'type' as trade_type, 
             pos->>'volume' as volume,
             pos->>'entryPrice' as entry_price,
             pos->>'pnl' as pnl
      FROM trading_accounts, 
           jsonb_array_elements(positions) as pos;
    `);

    console.log('\n=============================================================');
    console.log('                 ACTIVE / OPEN TRADES (BUY/SELL)              ');
    console.log('=============================================================');
    if (positionsRes.rows.length === 0) {
      console.log('No active positions found in the database.');
    } else {
      console.table(positionsRes.rows.map(row => ({
        'User Account': row.account_id,
        'Action': row.trade_type, // BUY or SELL
        'Symbol': row.symbol,
        'Volume (Lots)': parseFloat(row.volume),
        'Entry Price ($)': parseFloat(row.entry_price).toFixed(5),
        'P/L ($)': parseFloat(row.pnl).toFixed(2)
      })));
    }

    // 2. Get all closed trade history
    const historyRes = await client.query(`
      SELECT account_id, 
             hist->>'symbol' as symbol, 
             hist->>'type' as trade_type, 
             hist->>'volume' as volume,
             hist->>'entryPrice' as entry_price,
             hist->>'exitPrice' as exit_price,
             hist->>'pnl' as pnl,
             hist->>'exitReason' as reason
      FROM trading_accounts, 
           jsonb_array_elements(history) as hist;
    `);

    console.log('\n=============================================================');
    console.log('                 CLOSED TRADES HISTORY (BUY/SELL)             ');
    console.log('=============================================================');
    if (historyRes.rows.length === 0) {
      console.log('No closed trades in history yet.');
    } else {
      console.table(historyRes.rows.map(row => ({
        'User Account': row.account_id,
        'Action': row.trade_type, // BUY or SELL
        'Symbol': row.symbol,
        'Volume (Lots)': parseFloat(row.volume),
        'Entry Price ($)': parseFloat(row.entry_price).toFixed(5),
        'Exit Price ($)': parseFloat(row.exit_price).toFixed(5),
        'P/L ($)': parseFloat(row.pnl).toFixed(2),
        'Reason': row.reason
      })));
    }

  } catch (err) {
    console.error('Error fetching trade details:', err.message);
  } finally {
    await client.end();
  }
}

main();
