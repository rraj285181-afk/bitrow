// Mock Market Engine for Bitstar Crypto Demo App
// Real-world Integration: Fetches live prices and history from Hyperliquid and Yahoo Finance

const COIN_CONFIGS = {
  'BTC/USDT': { name: 'Bitcoin', icon: '₿', basePrice: 63427.43, volatility: 0.0003, decimalPlaces: 2 },
  'ETH/USDT': { name: 'Ethereum', icon: 'Ξ', basePrice: 3450.25, volatility: 0.0004, decimalPlaces: 2 },
  'EUR/USDT': { name: 'Euro vs US Dollar', icon: '💵', basePrice: 1.14650, volatility: 0.00008, decimalPlaces: 5 },
  'XAU/USDT': { name: 'Gold vs US Dollar', icon: '🪙', basePrice: 2337.42, volatility: 0.0002, decimalPlaces: 2 },
  'USOIL/USDT': { name: 'Crude Oil', icon: '🛢', basePrice: 78.50, volatility: 0.0004, decimalPlaces: 2 },
  'XAG/USDT': { name: 'Silver vs US Dollar', icon: '🥈', basePrice: 64.836, volatility: 0.00015, decimalPlaces: 5 }
};

class MockMarket {
  constructor() {
    this.coins = {};
    this.listeners = [];
    this.tickInterval = null;
    this.yahooPollingInterval = null; // store reference to clear if needed
    this.init();
  }

  init() {
    // Generate initial historical data and stats for all coins
    Object.keys(COIN_CONFIGS).forEach(symbol => {
      const config = COIN_CONFIGS[symbol];
      const base = config.basePrice;
      
      const changePercent = (Math.random() * 4 - 2); // -2% to +2%
      const yesterday = base / (1 + changePercent / 100);
      
      this.coins[symbol] = {
        symbol,
        name: config.name,
        icon: config.icon,
        currentPrice: base,
        lastRealPrice: null,
        yesterdayPrice: yesterday,
        high24h: base * (1 + Math.max(0, changePercent/100) + Math.random() * 0.01),
        low24h: base * (1 + Math.min(0, changePercent/100) - Math.random() * 0.01),
        decimalPlaces: config.decimalPlaces,
        volatility: config.volatility,
        history: {},
        fetchedTimeframes: {},
        historyVersion: 0
      };

      // Initialize empty arrays for history
      [1, 5, 15, 30, 60, 240, 1440].forEach(tf => {
        this.coins[symbol].history[tf] = [];
      });
    });

    // Start ticking loop
    this.startTicking();

    // Start live integrations
    this.initWebsocket();
    this.initYahooPolling();

    // Prefetch real history for default 15m timeframe
    Object.keys(COIN_CONFIGS).forEach(symbol => {
      this.fetchHistoryFromApi(symbol, 15);
    });
  }

  mapSymbolToYahoo(symbol) {
    if (symbol === 'EUR/USDT') return 'EURUSD=X';
    if (symbol === 'XAU/USDT') return 'GC=F';
    if (symbol === 'USOIL/USDT') return 'CL=F';
    if (symbol === 'XAG/USDT') return 'SI=F';
    return symbol;
  }

  mapTimeframeToYahooInterval(tf) {
    if (tf === 1) return '1m';
    if (tf === 2) return '2m';
    if (tf === 5) return '5m';
    if (tf === 15) return '15m';
    if (tf === 30) return '30m';
    if (tf === 60) return '60m';
    if (tf === 90) return '90m';
    if (tf === 1440) return '1d';
    if (tf > 60 && tf < 1440) return '60m';
    if (tf < 5) return '1m';
    if (tf < 15) return '5m';
    if (tf < 30) return '15m';
    if (tf < 60) return '30m';
    return '1d';
  }

  mapTimeframeToYahooRange(tf) {
    if (tf <= 5) return '1d';
    if (tf <= 15) return '5d';
    if (tf <= 60) return '7d';
    if (tf <= 240) return '15d';
    if (tf <= 1440) return '60d';
    return '1y';
  }

  mapTimeframeToHyperliquid(tf) {
    if (tf === 1) return '1m';
    if (tf === 5) return '5m';
    if (tf === 15) return '15m';
    if (tf === 30) return '30m';
    if (tf === 60) return '1h';
    if (tf === 120) return '2h';
    if (tf === 240) return '4h';
    if (tf === 480) return '8h';
    if (tf === 720) return '12h';
    if (tf === 1440) return '1d';
    if (tf < 5) return '1m';
    if (tf < 15) return '5m';
    if (tf < 30) return '15m';
    if (tf < 60) return '30m';
    if (tf < 120) return '1h';
    if (tf < 240) return '2h';
    if (tf < 480) return '4h';
    if (tf < 720) return '8h';
    if (tf < 1440) return '12h';
    return '1d';
  }

  mapTimeframeToHyperliquidMinutes(tf) {
    if (tf === 1 || tf === 5 || tf === 15 || tf === 30 || tf === 60 || tf === 120 || tf === 240 || tf === 480 || tf === 720 || tf === 1440) {
      return tf;
    }
    if (tf < 5) return 1;
    if (tf < 15) return 5;
    if (tf < 30) return 15;
    if (tf < 60) return 30;
    if (tf < 120) return 60;
    if (tf < 240) return 120;
    if (tf < 480) return 240;
    if (tf < 720) return 480;
    if (tf < 1440) return 720;
    return 1440;
  }

  mapTimeframeToYahooIntervalMinutes(tf) {
    if (tf === 1 || tf === 2 || tf === 5 || tf === 15 || tf === 30 || tf === 60 || tf === 90 || tf === 1440) {
      return tf;
    }
    if (tf > 60 && tf < 1440) return 60;
    if (tf < 5) return 1;
    if (tf < 15) return 5;
    if (tf < 30) return 15;
    if (tf < 60) return 30;
    return 1440;
  }

  aggregateCandles(candles, targetMin) {
    const intervalSec = targetMin * 60;
    const aggregated = [];
    let currentCandle = null;
    
    candles.forEach(c => {
      const bucketTime = c.time - (c.time % intervalSec);
      if (!currentCandle || currentCandle.time !== bucketTime) {
        if (currentCandle) {
          aggregated.push(currentCandle);
        }
        currentCandle = {
          time: bucketTime,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume
        };
      } else {
        currentCandle.close = c.close;
        if (c.high > currentCandle.high) currentCandle.high = c.high;
        if (c.low < currentCandle.low) currentCandle.low = c.low;
        currentCandle.volume += c.volume;
      }
    });
    
    if (currentCandle) {
      aggregated.push(currentCandle);
    }
    return aggregated;
  }

  generateMockHistory(symbol, timeframeMin) {
    const candles = [];
    const now = Math.floor(Date.now() / 1000);
    const intervalSec = timeframeMin * 60;
    const limit = 200;
    let basePrice = this.coins[symbol] ? this.coins[symbol].currentPrice : 1.0;
    if (basePrice <= 0) basePrice = 1.0;

    let time = now - (limit * intervalSec);
    let close = basePrice;

    for (let i = 0; i < limit; i++) {
      const open = close;
      const volatility = open * 0.002;
      const high = open + (Math.random() * volatility);
      const low = open - (Math.random() * volatility);
      close = low + (Math.random() * (high - low));
      
      candles.push({
        time: time,
        open: open,
        high: high,
        low: low,
        close: close,
        volume: Math.random() * 1000 + 100
      });
      time += intervalSec;
    }
    return candles;
  }

  async fetchHistoryFromApi(symbol, timeframeMin) {
    if (!this.coins[symbol].fetchedTimeframes) {
      this.coins[symbol].fetchedTimeframes = {};
    }
    if (!this.coins[symbol].history[timeframeMin]) {
      this.coins[symbol].history[timeframeMin] = [];
    }

    this.coins[symbol].fetchedTimeframes[timeframeMin] = 'fetching';

    try {
      let candles = [];
      if (symbol === 'BTC/USDT' || symbol === 'ETH/USDT') {
        const coinName = symbol === 'BTC/USDT' ? 'BTC' : 'ETH';
        const nativeTf = this.mapTimeframeToHyperliquidMinutes(timeframeMin);
        const intervalStr = this.mapTimeframeToHyperliquid(nativeTf);
        const limit = 500;
        const fetchMinutes = Math.max(timeframeMin, nativeTf);
        const startTime = Date.now() - limit * fetchMinutes * 60 * 1000;
        
        const response = await fetch('/api-hyperliquid/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'candleSnapshot',
            req: { coin: coinName, interval: intervalStr, startTime: startTime, endTime: Date.now() }
          })
        });
        if (!response.ok) throw new Error(`Hyperliquid API error: ${response.status}`);
        const data = await response.json();
        if (Array.isArray(data)) {
          candles = data.map(c => ({
            time: Math.floor(c.t / 1000),
            open: parseFloat(c.o),
            high: parseFloat(c.h),
            low: parseFloat(c.l),
            close: parseFloat(c.c),
            volume: parseFloat(c.v)
          }));
        }
        if (nativeTf !== timeframeMin && candles.length > 0) {
          candles = this.aggregateCandles(candles, timeframeMin);
        }
      } else {
        const yahooSymbol = this.mapSymbolToYahoo(symbol);
        const nativeTf = this.mapTimeframeToYahooIntervalMinutes(timeframeMin);
        const intervalStr = this.mapTimeframeToYahooInterval(nativeTf);
        const rangeStr = this.mapTimeframeToYahooRange(timeframeMin);
        
        const response = await fetch(`/api-yahoo/v8/finance/chart/${yahooSymbol}?interval=${intervalStr}&range=${rangeStr}`);
        if (!response.ok) throw new Error(`Yahoo Finance API error: ${response.status}`);
        const data = await response.json();
        if (data && data.chart && data.chart.result && data.chart.result[0]) {
          const result = data.chart.result[0];
          const timestamps = result.timestamp || [];
          const quote = result.indicators.quote[0];
          const opens = quote.open || [];
          const highs = quote.high || [];
          const lows = quote.low || [];
          const closes = quote.close || [];
          const volumes = quote.volume || [];

          let lastValidClose = null;
          for (let i = 0; i < timestamps.length; i++) {
            const time = timestamps[i];
            let open = opens[i];
            let high = highs[i];
            let low = lows[i];
            let close = closes[i];
            let volume = volumes[i] || 0;

            if (open == null || high == null || low == null || close == null) {
              if (lastValidClose !== null) {
                open = lastValidClose;
                high = lastValidClose;
                low = lastValidClose;
                close = lastValidClose;
              } else {
                continue;
              }
            }
            lastValidClose = close;

            candles.push({
              time: time,
              open: parseFloat(open),
              high: parseFloat(high),
              low: parseFloat(low),
              close: parseFloat(close),
              volume: parseFloat(volume)
            });
          }
        }
        if (nativeTf !== timeframeMin && candles.length > 0) {
          candles = this.aggregateCandles(candles, timeframeMin);
        }
      }

      if (candles && candles.length > 0) {
        // Clean, deduplicate and sort candles
        candles = candles.filter((candle, index, self) => 
          self.findIndex(c => c.time === candle.time) === index
        );
        candles.sort((a, b) => a.time - b.time);

        this.coins[symbol].history[timeframeMin] = candles;
        this.coins[symbol].fetchedTimeframes[timeframeMin] = true;
        this.coins[symbol].historyVersion = (this.coins[symbol].historyVersion || 0) + 1;
        
        const lastCandle = candles[candles.length - 1];
        if (lastCandle) {
          const coin = this.coins[symbol];
          coin.lastRealPrice = lastCandle.close;
          coin.currentPrice = lastCandle.close;
          
          const highPrices = candles.map(c => c.high);
          const lowPrices = candles.map(c => c.low);
          coin.high24h = Math.max(...highPrices);
          coin.low24h = Math.min(...lowPrices);
        }
        
        this.notify();
      } else {
        // Fallback to mock data if empty
        const mockCandles = this.generateMockHistory(symbol, timeframeMin);
        this.coins[symbol].history[timeframeMin] = mockCandles;
        this.coins[symbol].fetchedTimeframes[timeframeMin] = true;
        this.coins[symbol].historyVersion = (this.coins[symbol].historyVersion || 0) + 1;
        this.notify();
      }
    } catch (error) {
      console.error(`Failed to fetch history for ${symbol} (${timeframeMin}m):`, error);
      // Fallback to mock data on error
      const mockCandles = this.generateMockHistory(symbol, timeframeMin);
      this.coins[symbol].history[timeframeMin] = mockCandles;
      this.coins[symbol].fetchedTimeframes[timeframeMin] = true;
      this.coins[symbol].historyVersion = (this.coins[symbol].historyVersion || 0) + 1;
      this.notify();
    }
  }

  initWebsocket() {
    let reconnectTimer = null;
    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws-hyperliquid/ws`;
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log('Hyperliquid WS Connected');
        if (reconnectTimer) clearTimeout(reconnectTimer);
        ws.send(JSON.stringify({
          method: 'subscribe',
          subscription: { type: 'allMids' }
        }));
      };
      
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.channel === 'allMids' && msg.data && msg.data.mids) {
            const btcPrice = parseFloat(msg.data.mids.BTC);
            if (btcPrice && !isNaN(btcPrice)) {
              const coin = this.coins['BTC/USDT'];
              if (coin) {
                coin.lastRealPrice = btcPrice;
                this.updateLastCandlePrice(coin, btcPrice);
              }
            }
            const ethPrice = parseFloat(msg.data.mids.ETH);
            if (ethPrice && !isNaN(ethPrice)) {
              const coin = this.coins['ETH/USDT'];
              if (coin) {
                coin.lastRealPrice = ethPrice;
                this.updateLastCandlePrice(coin, ethPrice);
              }
            }
          }
        } catch (err) {
          console.error('Failed to parse Hyperliquid WS message:', err);
        }
      };
      
      ws.onerror = (err) => {
        console.error('Hyperliquid WS error:', err);
      };
      
      ws.onclose = () => {
        console.log('Hyperliquid WS closed. Reconnecting in 5s...');
        reconnectTimer = setTimeout(connect, 5000);
      };
    };
    
    connect();
  }

  initYahooPolling() {
    const symbolsToPoll = ['EUR/USDT', 'XAU/USDT', 'USOIL/USDT', 'XAG/USDT'];
    
    const poll = async () => {
      for (const symbol of symbolsToPoll) {
        try {
          const yahooSymbol = this.mapSymbolToYahoo(symbol);
          const response = await fetch(`/api-yahoo/v8/finance/chart/${yahooSymbol}?interval=1m&range=1d`);
          if (!response.ok) {
            console.warn(`Yahoo poll for ${symbol} returned ${response.status}, skipping.`);
            continue;
          }
          const data = await response.json();
          if (data && data.chart && data.chart.result && data.chart.result[0]) {
            const meta = data.chart.result[0].meta;
            const realPrice = meta.regularMarketPrice;
            if (realPrice && !isNaN(realPrice)) {
              const coin = this.coins[symbol];
              if (coin) {
                coin.lastRealPrice = realPrice;
                this.updateLastCandlePrice(coin, realPrice);
              }
            }
          }
        } catch (error) {
          console.error(`Failed to poll Yahoo price for ${symbol}:`, error);
        }
      }
    };

    poll();
    this.yahooPollingInterval = setInterval(poll, 8000); // store reference; 8s to avoid rate limit
  }

  updateLastCandlePrice(coin, newPrice) {
    coin.currentPrice = newPrice;
    if (coin.high24h === null || coin.high24h === undefined || newPrice > coin.high24h) coin.high24h = newPrice;
    if (coin.low24h === null || coin.low24h === undefined || newPrice < coin.low24h) coin.low24h = newPrice;

    const nowSec = Math.floor(Date.now() / 1000);
    Object.keys(coin.history).map(Number).forEach(tf => {
      const history = coin.history[tf];
      if (!history || history.length === 0) return;
      
      const intervalSec = tf * 60;
      const currentCandleTime = nowSec - (nowSec % intervalSec);
      const lastCandle = history[history.length - 1];
      const targetTime = Math.max(currentCandleTime, lastCandle.time);

      if (lastCandle.time === targetTime) {
        lastCandle.close = parseFloat(newPrice.toFixed(coin.decimalPlaces));
        if (newPrice > lastCandle.high) lastCandle.high = parseFloat(newPrice.toFixed(coin.decimalPlaces));
        if (newPrice < lastCandle.low) lastCandle.low = parseFloat(newPrice.toFixed(coin.decimalPlaces));
      } else {
        const openVal = parseFloat(lastCandle.close.toFixed(coin.decimalPlaces));
        const newCandle = {
          time: targetTime,
          open: openVal,
          high: parseFloat(Math.max(openVal, newPrice).toFixed(coin.decimalPlaces)),
          low: parseFloat(Math.min(openVal, newPrice).toFixed(coin.decimalPlaces)),
          close: parseFloat(newPrice.toFixed(coin.decimalPlaces)),
          volume: 0
        };
        history.push(newCandle);
        if (history.length > 500) {
          history.shift();
        }
      }
    });
    this.notify();
  }

  startTicking() {
    this.tickInterval = setInterval(() => {
      this.tick();
    }, 800);
  }

  tick() {
    const nowSec = Math.floor(Date.now() / 1000);
    
    Object.keys(this.coins).forEach(symbol => {
      const coin = this.coins[symbol];
      const base = coin.lastRealPrice || coin.currentPrice;
      const newPrice = base; // No random fluctuation!
      
      coin.currentPrice = newPrice;
      
      if (newPrice > coin.high24h) coin.high24h = newPrice;
      if (newPrice < coin.low24h) coin.low24h = newPrice;

      Object.keys(coin.history).map(Number).forEach(tf => {
        const history = coin.history[tf];
        if (!history || history.length === 0) return;
        
        const intervalSec = tf * 60;
        const currentCandleTime = nowSec - (nowSec % intervalSec);
        const lastCandle = history[history.length - 1];

        // Ensure we never create or update a candle with a timestamp older than the last one in history
        const targetTime = Math.max(currentCandleTime, lastCandle.time);

        if (lastCandle.time === targetTime) {
          lastCandle.close = parseFloat(newPrice.toFixed(coin.decimalPlaces));
          if (newPrice > lastCandle.high) lastCandle.high = parseFloat(newPrice.toFixed(coin.decimalPlaces));
          if (newPrice < lastCandle.low) lastCandle.low = parseFloat(newPrice.toFixed(coin.decimalPlaces));
        } else {
          const openVal = parseFloat(lastCandle.close.toFixed(coin.decimalPlaces));
          const newCandle = {
            time: targetTime,
            open: openVal,
            high: parseFloat(Math.max(openVal, newPrice).toFixed(coin.decimalPlaces)),
            low: parseFloat(Math.min(openVal, newPrice).toFixed(coin.decimalPlaces)),
            close: parseFloat(newPrice.toFixed(coin.decimalPlaces)),
            volume: 0
          };
          history.push(newCandle);
          if (history.length > 500) {
            history.shift();
          }
        }
      });
    });

    this.listeners.forEach(callback => callback(this.coins));
  }

  subscribe(callback) {
    this.listeners.push(callback);
    callback(this.coins);
    
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  notify() {
    this.listeners.forEach(callback => callback(this.coins));
  }

  getLatestPrice(symbol) {
    let mapped = symbol;
    if (symbol === 'BTCUSD') mapped = 'BTC/USDT';
    if (symbol === 'ETHUSD') mapped = 'ETH/USDT';
    if (symbol === 'EURUSD') mapped = 'EUR/USDT';
    if (symbol === 'XAUUSD') mapped = 'XAU/USDT';
    if (symbol === 'USOIL') mapped = 'USOIL/USDT';
    if (symbol === 'XAGUSD') mapped = 'XAG/USDT';
    const coin = this.coins[mapped];
    return coin ? coin.currentPrice : 0;
  }

  getHistory(symbol, timeframeMin) {
    const coin = this.coins[symbol];
    if (!coin) return [];
    
    // If we haven't fetched real history for this timeframe yet, trigger the fetch
    if (!coin.fetchedTimeframes || !coin.fetchedTimeframes[timeframeMin]) {
      if (!coin.fetchedTimeframes) coin.fetchedTimeframes = {};
      coin.fetchedTimeframes[timeframeMin] = 'fetching';
      
      coin.history[timeframeMin] = [];
      this.fetchHistoryFromApi(symbol, timeframeMin);
    }
    
    return coin.history[timeframeMin] || [];
  }
}

export const marketEngine = new MockMarket();
