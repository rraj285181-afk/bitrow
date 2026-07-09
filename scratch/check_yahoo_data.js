const symbols = ['EURUSD=X', 'GC=F', 'CL=F', 'SI=F'];

async function checkMeta() {
  for (const symbol of symbols) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      const data = await response.json();
      if (data && data.chart && data.chart.result && data.chart.result[0]) {
        const meta = data.chart.result[0].meta;
        console.log(`Symbol: ${symbol} -> regularMarketPrice: ${meta.regularMarketPrice}, chartPreviousClose: ${meta.chartPreviousClose}`);
      }
    } catch (err) {
      console.error(err);
    }
  }
}

checkMeta();
