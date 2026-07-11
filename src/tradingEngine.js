// Trading Engine for Bitstar Crypto Demo App
// Manages positions, orders, account stats, and triggers SL/TP/liquidations

function getSpread(symbol, currentPrice, accountType = 'Standard') {
  const cleanSymbol = symbol.replace('/', '').replace('=X', '').replace('=F', '');
  let baseSpread = 0.03;
  if (cleanSymbol.includes('BTC')) baseSpread = 15.00;
  else if (cleanSymbol.includes('ETH')) baseSpread = 1.50;
  else if (cleanSymbol.includes('EUR')) baseSpread = 0.00008; // 0.8 pips
  else if (cleanSymbol.includes('XAU') || cleanSymbol === 'GC') baseSpread = 0.25;    // 25 cents
  else if (cleanSymbol.includes('XAG') || cleanSymbol === 'SI') baseSpread = 0.015;   // 1.5 cents

  if (accountType === 'Pro') {
    return baseSpread * 0.7; // 30% spread discount
  } else if (accountType === 'Raw Spread') {
    return baseSpread * 0.2; // 80% spread discount
  } else if (accountType === 'Zero') {
    return baseSpread * 0.05; // 95% spread discount
  }
  return baseSpread; // Standard
}

function getPipSize(symbol) {
  const cleanSymbol = symbol.replace('/', '').replace('=X', '').replace('=F', '');
  if (cleanSymbol.includes('BTC')) return 1.00;
  if (cleanSymbol.includes('ETH')) return 1.00;
  if (cleanSymbol.includes('EUR')) return 0.0001;
  if (cleanSymbol.includes('XAU') || cleanSymbol === 'GC') return 0.01;
  if (cleanSymbol.includes('XAG') || cleanSymbol === 'SI') return 0.01; // Silver
  return 0.01; // USOIL
}

export function getLotMultiplier(symbol) {
  if (!symbol) return 1.0;
  if (symbol.startsWith('BTC')) return 1.0;     // 1 BTC per lot
  if (symbol.startsWith('ETH')) return 10.0;    // 10 ETH per lot
  if (symbol.startsWith('EUR')) return 100000.0; // 100,000 EUR per lot
  if (symbol.startsWith('XAU') || symbol.startsWith('GC')) return 100.0;    // 100 oz of Gold per lot
  if (symbol.startsWith('XAG') || symbol.startsWith('SI')) return 5000.0;   // 5,000 oz of Silver per lot
  return 1000.0; // USOIL: 1,000 barrels per lot
}

class TradingEngine {
  constructor() {
    this.storageKey = 'bitstar_demo_account_v1';
    this.listeners = [];
    this.isGuest = true; // Default to guest until authenticated
    this.accountType = 'Standard';
    this.leverage = 200;
    this.loadState();
    this.startHeartbeat();
  }

  // Load state from server only (preserving session account ID from localStorage)
  loadState() {
    this.loadAccountIdFromLocalStorage();
  }

  // Retrieve only the persistent session Account ID from localStorage
  loadAccountIdFromLocalStorage() {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        this.accountId = parsed.accountId || this.generateAccountId();
      } else {
        this.accountId = this.generateAccountId();
      }
    } catch (e) {
      console.error("Failed to load accountId from localStorage:", e);
      this.accountId = this.generateAccountId();
    }
    
    // Initialize actual trading variables to zero/empty (non-cached)
    this.balance = 0.00;
    this.positions = [];
    this.pendingOrders = [];
    this.history = [];
    this.accountType = 'Standard';
    this.leverage = 200;
    this.isLoaded = false; // database load status flag
    
    this.recalculateStats({});
  }

  // Asynchronous load from PostgreSQL server
  loadStateFromServer() {
    if (!this.accountId) return;

    // Reset load state to trigger showing loader
    this.isLoaded = false;
    this.notify();

    fetch(`/api/account/${encodeURIComponent(this.accountId)}`)
      .then(res => {
        if (res.status === 401 || res.status === 403) {
          if (this.onAuthFailure) this.onAuthFailure();
          throw new Error(`Auth error ${res.status}`);
        }
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (data) {
          this.balance = parseFloat(data.balance) || 10000.00;
          this.positions = data.positions || [];
          this.pendingOrders = data.pendingOrders || [];
          this.history = data.history || [];
          this.accountType = data.accountType || 'Standard';
          this.leverage = parseInt(data.leverage) || 200;
          this.isLoaded = true; // Connection successful
          this.recalculateStats({});
          this.notify();
        }
      })
      .catch(err => {
        console.warn("Failed to load state from PostgreSQL backend:", err);
        this.isLoaded = false; // Flag connection failure
        this.notify();
      });
  }

  resetDefaults() {
    this.accountId = this.accountId || this.generateAccountId();
    this.balance = 10000.00;
    this.positions = [];
    this.pendingOrders = [];
    this.history = [];
    this.accountType = 'Standard';
    this.leverage = 200;
    this.isLoaded = true;
  }

  saveState() {
    if (this.balance < 0) {
      this.balance = 0;
      this.logNotification('info', 'Negative Balance Protection', 'Account balance reset to 0.00 USD.');
    }
    // 1. Sync ONLY the session accountId to localStorage
    try {
      const session = {
        accountId: this.accountId
      };
      localStorage.setItem(this.storageKey, JSON.stringify(session));
    } catch (e) {
      console.error("Failed to save accountId to localStorage:", e);
    }

    // 2. Sync everything to PostgreSQL server
    this.saveStateToServer();
  }

  saveStateToServer() {
    if (!this.accountId) return;

    const state = {
      accountId: this.accountId,
      balance: this.balance,
      positions: this.positions,
      pendingOrders: this.pendingOrders,
      history: this.history,
      accountType: this.accountType,
      leverage: this.leverage
    };

    fetch('/api/account/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(state)
    })
    .then(res => {
      if (res.status === 401 || res.status === 403) {
        if (this.onAuthFailure) this.onAuthFailure();
        throw new Error(`Auth error ${res.status}`);
      }
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json();
    })
    .then(() => {
      if (!this.isLoaded) {
        this.isLoaded = true;
        this.notify();
      }
    })
    .catch(err => {
      console.warn("Failed to sync state to PostgreSQL backend:", err);
      this.isLoaded = false;
      this.notify();
    });
  }

  startHeartbeat() {
    // Ping backend every 3 seconds to check connection health instantly
    this.heartbeatInterval = setInterval(() => {
      this.checkConnectionHealth();
    }, 3000);
  }

  checkConnectionHealth() {
    if (!this.accountId) return;

    fetch(`/api/account/${encodeURIComponent(this.accountId)}`)
      .then(res => {
        if (res.status === 401 || res.status === 403) {
          if (this.onAuthFailure) this.onAuthFailure();
          throw new Error(`Auth error ${res.status}`);
        }
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        return res.json();
      })
      .then(() => {
        if (!this.isLoaded) {
          this.isLoaded = true;
          this.notify();
        }
      })
      .catch(err => {
        console.warn("Heartbeat connection check failed:", err.message);
        if (this.isLoaded) {
          this.isLoaded = false;
          this.notify();
        }
      });
  }

  generateAccountId() {
    return 'Real #' + Math.floor(100000 + Math.random() * 900000);
  }

  resetAccount() {
    this.resetDefaults();
    this.recalculateStats({});
    this.saveState();
    this.notify();
  }

  // Recalculates Equity, Margin, Free Margin, Margin Level based on live prices
  recalculateStats(livePrices) {
    let totalPnl = 0;
    let totalMargin = 0;

    // Update prices & P&L for open positions
    this.positions.forEach(pos => {
      const priceInfo = livePrices[pos.symbol];
      if (priceInfo && priceInfo.currentPrice && !isNaN(priceInfo.currentPrice)) {
        const midPrice = priceInfo.currentPrice;
        const spreadDiff = getSpread(pos.symbol, midPrice, this.accountType);
        if (pos.type === 'BUY') {
          // BUY is closed by selling at bid price
          pos.currentPrice = midPrice - (spreadDiff / 2);
        } else {
          // SELL is closed by buying at ask price
          pos.currentPrice = midPrice + (spreadDiff / 2);
        }
      }

      // Safeguard: Ensure currentPrice is a valid number
      if (pos.currentPrice === null || pos.currentPrice === undefined || isNaN(pos.currentPrice)) {
        pos.currentPrice = pos.entryPrice || 0;
      }

      // Calculate P&L: Buy profit = (current - entry) * volume; Sell profit = (entry - current) * volume
      if (pos.type === 'BUY') {
        pos.pnl = (pos.currentPrice - pos.entryPrice) * pos.volume;
      } else {
        pos.pnl = (pos.entryPrice - pos.currentPrice) * pos.volume;
      }

      // Safeguard: Ensure pnl is not NaN
      if (isNaN(pos.pnl)) {
        pos.pnl = 0;
      }

      totalPnl += pos.pnl;
    });

    // Calculate total margin using Hedging Margin Offset (max margin of BUY vs SELL side per symbol)
    const marginMap = {};
    this.positions.forEach(pos => {
      if (!marginMap[pos.symbol]) {
        marginMap[pos.symbol] = { buy: 0, sell: 0 };
      }
      if (pos.type === 'BUY') {
        marginMap[pos.symbol].buy += pos.margin;
      } else {
        marginMap[pos.symbol].sell += pos.margin;
      }
    });

    Object.keys(marginMap).forEach(sym => {
      totalMargin += Math.max(marginMap[sym].buy, marginMap[sym].sell);
    });

    this.equity = this.balance + totalPnl;
    this.marginUsed = totalMargin;
    this.freeMargin = this.equity - this.marginUsed;
    
    if (this.marginUsed > 0) {
      this.marginLevel = (this.equity / this.marginUsed) * 100;
    } else {
      this.marginLevel = null; // N/A
    }
  }

  // Checks and processes SL/TP triggers, pending order executions, and stop-outs
  updateMarketPrices(livePrices) {
    let stateChanged = false;

    // 1. Recalculate account numbers
    this.recalculateStats(livePrices);

    // 2. Check pending limit orders
    const pendingToExecute = [];
    this.pendingOrders = this.pendingOrders.filter(order => {
      const priceInfo = livePrices[order.symbol];
      if (!priceInfo) return true;

      const midPrice = priceInfo.currentPrice;
      const spreadDiff = getSpread(order.symbol, midPrice, this.accountType);
      let execute = false;

      if (order.type === 'BUY') {
        // Buy Limit triggers if Ask price falls to or below target
        const askPrice = midPrice + (spreadDiff / 2);
        if (askPrice <= order.targetPrice) {
          execute = true;
        }
      } else {
        // Sell Limit triggers if Bid price rises to or above target
        const bidPrice = midPrice - (spreadDiff / 2);
        if (bidPrice >= order.targetPrice) {
          execute = true;
        }
      }

      if (execute) {
        pendingToExecute.push(order);
        stateChanged = true;
        return false; // remove from pending
      }
      return true; // keep
    });

    // Execute the triggered limit orders
    pendingToExecute.forEach(order => {
      const livePrice = livePrices[order.symbol].currentPrice;
      const spreadDiff = getSpread(order.symbol, livePrice, this.accountType);
      const executionPrice = order.type === 'BUY' ? livePrice + (spreadDiff / 2) : livePrice - (spreadDiff / 2);
      
      const lev = order.leverage === 'Unlimited' ? 2100000000 : (parseInt(order.leverage) || 200);
      const marginReq = lev >= 100000 ? 0 : (order.volume * executionPrice) / lev;
      
      const lotMult = getLotMultiplier(order.symbol);
      const volumeInLots = order.volume / lotMult;
      
      let openComm = 0;
      let closeComm = 0;
      if (this.accountType === 'Raw Spread') {
        openComm = volumeInLots * 3.50;
        closeComm = volumeInLots * 3.50;
      } else if (this.accountType === 'Zero') {
        openComm = volumeInLots * 7.00;
        closeComm = volumeInLots * 7.00;
      }
      
      const fee = 0; // No commission fee, spread (pips) is the only cost

      // Re-verify margin sufficiency at execution time
      if (this.freeMargin >= marginReq + fee + openComm) {
        this.balance -= (fee + openComm);
        const position = {
          id: order.id,
          symbol: order.symbol,
          type: order.type,
          leverage: order.leverage,
          volume: order.volume,
          entryPrice: executionPrice,
          currentPrice: executionPrice,
          margin: marginReq,
          commission: openComm,
          closeCommission: closeComm,
          pnl: 0,
          tp: order.tp,
          sl: order.sl,
          timestamp: Date.now(),
          tsl: null,
          tslTriggerPrice: null,
          favorablePrice: executionPrice,
          tpTargets: []
        };
        this.positions.push(position);
        this.logNotification('success', 'Order Filled', `Limit Order filled: ${order.type} ${(order.volume / lotMult).toFixed(2)} lots of ${order.symbol.split('/')[0]} @ $${livePrice.toFixed(2)}`);
        
        // Recalculate stats immediately to update freeMargin for the next order
        this.recalculateStats(livePrices);
      } else {
        // Cancel order due to insufficient funds
        this.history.unshift({
          id: order.id,
          symbol: order.symbol,
          type: order.type,
          leverage: order.leverage,
          volume: order.volume,
          entryPrice: order.targetPrice,
          exitPrice: order.targetPrice,
          exitReason: 'Cancelled (Margin Shortage)',
          commission: 0,
          pnl: 0,
          openTime: order.timestamp,
          closeTime: Date.now(),
          tp: order.tp || null,
          sl: order.sl || null,
          swap: 0,
          timestamp: Date.now()
        });
        this.logNotification('error', 'Order Cancelled', `Limit Order cancelled: Insufficient margin to execute ${order.type} ${order.symbol}`);
      }
    });

    // 2.5 Update Trailing Stop Loss and check Multiple TP targets
    const pendingPartialCloses = [];
    this.positions.forEach(pos => {
      const price = pos.currentPrice;
      
      // Initialize favorablePrice if not set
      if (pos.favorablePrice === undefined || pos.favorablePrice === null) {
        pos.favorablePrice = pos.entryPrice;
      }
      
      // Trailing Stop Loss Update
      if (pos.tsl && pos.tsl > 0) {
        const pipSize = getPipSize(pos.symbol);
        const tslDistance = pos.tsl * pipSize;
        
        if (pos.type === 'BUY') {
          if (price > pos.favorablePrice) {
            pos.favorablePrice = price;
          }
          pos.tslTriggerPrice = pos.favorablePrice - tslDistance;
          if (!pos.sl || pos.tslTriggerPrice > pos.sl) {
            pos.sl = pos.tslTriggerPrice;
            stateChanged = true;
          }
        } else {
          if (price < pos.favorablePrice) {
            pos.favorablePrice = price;
          }
          pos.tslTriggerPrice = pos.favorablePrice + tslDistance;
          if (!pos.sl || pos.tslTriggerPrice < pos.sl) {
            pos.sl = pos.tslTriggerPrice;
            stateChanged = true;
          }
        }
      }

      // Check Multiple Take Profit Targets
      if (pos.tpTargets && pos.tpTargets.length > 0) {
        pos.tpTargets.forEach(target => {
          if (!target.triggered) {
            let hit = false;
            if (pos.type === 'BUY' && price >= target.price) {
              hit = true;
            } else if (pos.type === 'SELL' && price <= target.price) {
              hit = true;
            }

            if (hit) {
              target.triggered = true;
              const closeVol = pos.volume * (target.pct / 100);
              pendingPartialCloses.push({
                positionId: pos.id,
                volume: closeVol,
                reason: `Take Profit Target $${target.price}`
              });
            }
          }
        });
        pos.tpTargets = pos.tpTargets.filter(t => !t.triggered);
      }
    });

    // 3. Check TP / SL for Open Positions
    this.positions = this.positions.filter(pos => {
      const current = pos.currentPrice;
      let triggerClose = false;
      let closePrice = current;
      let reason = 'Market Close';

      if (pos.type === 'BUY') {
        if (pos.tp && current >= pos.tp) {
          triggerClose = true;
          closePrice = pos.tp; // execute exactly at TP limit
          reason = 'Take Profit';
        } else if (pos.sl && current <= pos.sl) {
          triggerClose = true;
          closePrice = pos.sl; // execute exactly at SL limit
          reason = pos.tsl ? 'Trailing Stop' : 'Stop Loss';
        }
      } else {
        // Sell (Short) TP is below entry, SL is above entry
        if (pos.tp && current <= pos.tp) {
          triggerClose = true;
          closePrice = pos.tp;
          reason = 'Take Profit';
        } else if (pos.sl && current >= pos.sl) {
          triggerClose = true;
          closePrice = pos.sl;
          reason = pos.tsl ? 'Trailing Stop' : 'Stop Loss';
        }
      }

      if (triggerClose) {
        const finalPnl = pos.type === 'BUY' ? 
          (closePrice - pos.entryPrice) * pos.volume : 
          (pos.entryPrice - closePrice) * pos.volume;

        const closeComm = pos.closeCommission || 0;
        this.balance += (finalPnl - closeComm);
        
        this.history.unshift({
          id: pos.id,
          symbol: pos.symbol,
          type: pos.type,
          leverage: pos.leverage,
          volume: pos.volume,
          entryPrice: pos.entryPrice,
          exitPrice: closePrice,
          exitReason: reason,
          commission: (pos.commission || 0) + closeComm,
          pnl: finalPnl - closeComm,
          openTime: pos.timestamp,
          closeTime: Date.now(),
          tp: pos.tp || null,
          sl: pos.sl || null,
          swap: 0,
          timestamp: Date.now()
        });

        this.logNotification(finalPnl - closeComm >= 0 ? 'success' : 'info', `Position Closed (${reason})`, 
          `${pos.symbol.split('/')[0]} ${pos.type} closed @ $${closePrice.toFixed(2)}. P&L: $${(finalPnl - closeComm).toFixed(2)}`
        );

        stateChanged = true;
        return false; // remove from positions
      }
      return true; // keep position open
    });

    // Execute pending partial closes from Multi-TP triggers
    if (pendingPartialCloses.length > 0) {
      pendingPartialCloses.forEach(task => {
        this.partialClosePosition(task.positionId, task.volume, task.reason);
      });
      stateChanged = true;
    }

    // 4. Check Liquidation (Stop-out at 50% Margin Level)
    this.recalculateStats(livePrices);
    while (this.marginLevel !== null && this.marginLevel < 50 && this.positions.length > 0) {
      // Find the position with the biggest loss
      let worstIndex = 0;
      let worstPnl = this.positions[0].pnl;

      for (let i = 1; i < this.positions.length; i++) {
        if (this.positions[i].pnl < worstPnl) {
          worstPnl = this.positions[i].pnl;
          worstIndex = i;
        }
      }

      const liquidatedPos = this.positions.splice(worstIndex, 1)[0];
      
      this.balance += (liquidatedPos.pnl - (liquidatedPos.closeCommission || 0));
      
      this.history.unshift({
        id: liquidatedPos.id,
        symbol: liquidatedPos.symbol,
        type: liquidatedPos.type,
        leverage: liquidatedPos.leverage,
        volume: liquidatedPos.volume,
        entryPrice: liquidatedPos.entryPrice,
        exitPrice: liquidatedPos.currentPrice,
        exitReason: 'Liquidation (Stop Out)',
        commission: (liquidatedPos.commission || 0) + (liquidatedPos.closeCommission || 0),
        pnl: liquidatedPos.pnl - (liquidatedPos.closeCommission || 0),
        openTime: liquidatedPos.timestamp,
        closeTime: Date.now(),
        tp: liquidatedPos.tp || null,
        sl: liquidatedPos.sl || null,
        swap: 0,
        timestamp: Date.now()
      });

      this.logNotification('error', 'Liquidation Triggered', 
        `Stop out! ${liquidatedPos.symbol} position liquidated @ $${liquidatedPos.currentPrice.toFixed(2)} due to margin level < 50%.`
      );

      stateChanged = true;
      // Recalculate stats for next loop iteration
      this.recalculateStats(livePrices);
    }

    // Negative Balance Protection check
    if (this.balance < 0) {
      this.balance = 0;
      this.logNotification('info', 'Negative Balance Protection', 'Account balance reset to 0.00 USD under negative balance protection.');
      stateChanged = true;
      this.recalculateStats(livePrices);
    }

    if (stateChanged) {
      this.saveState();
    }

    // Always trigger UI update so ticking values refresh
    this.notify();
  }

  // Executes a new Market or Limit Order
  placeOrder(orderParams) {
    if (!orderParams) return false;
    if (this.isGuest) {
      this.logNotification('error', 'Order Rejected', 'Please Sign In with Google to place trades.');
      return false;
    }
    const { symbol, type, volume, leverage, orderType, targetPrice, tp, sl } = orderParams;
    const price = orderType === 'MARKET' ? targetPrice : targetPrice;
    
    // Safety checks
    if (!symbol || !type || !volume || volume <= 0 || !leverage || isNaN(price) || price <= 0) {
      this.logNotification('error', 'Order Rejected', 'Invalid order details or market price.');
      return false;
    }
    
    const lev = leverage === 'Unlimited' ? 2100000000 : (parseInt(leverage) || 200);
    const sizeVal = volume * price;
    const marginReq = lev >= 100000 ? 0 : sizeVal / lev;
    
    const lotMult = getLotMultiplier(symbol);
    const volumeInLots = volume / lotMult;
    
    let openCommission = 0;
    let closeCommission = 0;
    if (this.accountType === 'Raw Spread') {
      openCommission = volumeInLots * 3.50;
      closeCommission = volumeInLots * 3.50;
    } else if (this.accountType === 'Zero') {
      openCommission = volumeInLots * 7.00;
      closeCommission = volumeInLots * 7.00;
    }

    const fee = 0; // No commission fee, spread (pips) is the only cost

    // Check if margin is sufficient
    if (this.freeMargin < marginReq + fee + openCommission) {
      this.logNotification('error', 'Margin Warning', 'Insufficient Free Margin + fees to open this position.');
      return false;
    }

    const orderId = 'ord_' + Math.random().toString(36).substring(2, 11);

    if (orderType === 'MARKET') {
      // Execute immediately
      this.balance -= (fee + openCommission);
      
      const newPosition = {
        id: orderId,
        symbol,
        type,
        leverage,
        volume,
        entryPrice: price,
        currentPrice: price,
        margin: marginReq,
        commission: openCommission,
        closeCommission: closeCommission,
        pnl: 0,
        tp: tp || null,
        sl: sl || null,
        timestamp: Date.now(),
        tsl: null,
        tslTriggerPrice: null,
        favorablePrice: price,
        tpTargets: []
      };

      this.positions.push(newPosition);
      this.saveState();
      this.logNotification('success', 'Order Executed', `Opened ${type} ${(volume / lotMult).toFixed(2)} lots of ${symbol.split('/')[0]} @ $${price.toFixed(2)}`);
    } else {
      // Place limit order
      const newLimitOrder = {
        id: orderId,
        symbol,
        type,
        targetPrice: price,
        leverage,
        volume,
        tp: tp || null,
        sl: sl || null,
        timestamp: Date.now()
      };

      this.pendingOrders.push(newLimitOrder);
      this.saveState();
      this.logNotification('info', 'Limit Order Placed', `Set Limit ${type} ${(volume / lotMult).toFixed(2)} lots of ${symbol.split('/')[0]} @ $${price.toFixed(2)}`);
    }

    this.recalculateStats({});
    this.notify();
    return true;
  }

  // Modifies Stop Loss and Take Profit of an open position
  modifyPositionSLTP(positionId, sl, tp) {
    const index = this.positions.findIndex(p => p.id === positionId);
    if (index === -1) return false;

    const pos = this.positions[index];
    const currentPrice = pos.currentPrice;

    if (sl !== undefined && sl !== null) {
      if (pos.type === 'BUY' && sl >= currentPrice) {
        this.logNotification('error', 'Invalid Stop Loss', `SL for Buy position must be below current price ($${currentPrice.toFixed(2)}).`);
        return false;
      }
      if (pos.type === 'SELL' && sl <= currentPrice) {
        this.logNotification('error', 'Invalid Stop Loss', `SL for Sell position must be above current price ($${currentPrice.toFixed(2)}).`);
        return false;
      }
      pos.sl = sl;
    }

    if (tp !== undefined && tp !== null) {
      if (pos.type === 'BUY' && tp <= currentPrice) {
        this.logNotification('error', 'Invalid Take Profit', `TP for Buy position must be above current price ($${currentPrice.toFixed(2)}).`);
        return false;
      }
      if (pos.type === 'SELL' && tp >= currentPrice) {
        this.logNotification('error', 'Invalid Take Profit', `TP for Sell position must be below current price ($${currentPrice.toFixed(2)}).`);
        return false;
      }
      pos.tp = tp;
    }

    this.saveState();
    this.logNotification('success', 'SL/TP Updated', `Position SL/TP updated successfully.`);
    this.recalculateStats({});
    this.notify();
    return true;
  }

  // Closes a partial amount of an open position
  partialClosePosition(positionId, closeVolume, reason = 'Partial Close') {
    const index = this.positions.findIndex(p => p.id === positionId);
    if (index === -1) return false;

    const pos = this.positions[index];
    
    // Safety check
    if (closeVolume <= 0 || closeVolume >= pos.volume) {
      if (closeVolume >= pos.volume) {
        return this.closePosition(positionId);
      }
      return false;
    }

    const remainingVolume = pos.volume - closeVolume;
    const ratio = closeVolume / pos.volume;
    
    // Calculate P&L for closed portion
    let closedPnl = 0;
    if (pos.type === 'BUY') {
      closedPnl = (pos.currentPrice - pos.entryPrice) * closeVolume;
    } else {
      closedPnl = (pos.entryPrice - pos.currentPrice) * closeVolume;
    }

    const closedOpenComm = (pos.commission || 0) * ratio;
    const closedCloseComm = (pos.closeCommission || 0) * ratio;

    this.balance += (closedPnl - closedCloseComm);

    // Push closed part to history
    this.history.unshift({
      id: pos.id + '_p' + Math.floor(Math.random() * 1000),
      symbol: pos.symbol,
      type: pos.type,
      leverage: pos.leverage,
      volume: closeVolume,
      entryPrice: pos.entryPrice,
      exitPrice: pos.currentPrice,
      exitReason: reason,
      commission: closedOpenComm + closedCloseComm,
      pnl: closedPnl - closedCloseComm,
      openTime: pos.timestamp,
      closeTime: Date.now(),
      tp: pos.tp || null,
      sl: pos.sl || null,
      swap: 0,
      timestamp: Date.now()
    });

    // Update remaining position
    pos.volume = remainingVolume;
    pos.margin = pos.margin * (1 - ratio);
    pos.pnl = pos.pnl * (1 - ratio);
    pos.commission = (pos.commission || 0) * (1 - ratio);
    pos.closeCommission = (pos.closeCommission || 0) * (1 - ratio);

    this.saveState();
    const lotMult = getLotMultiplier(pos.symbol);
    this.logNotification('success', 'Partial Close Executed', `Closed ${(closeVolume / lotMult).toFixed(2)} lots of ${pos.symbol.split('/')[0]}. P&L: $${(closedPnl - closedCloseComm).toFixed(2)}`);
    
    this.recalculateStats({});
    this.notify();
    return true;
  }

  // Modifies advanced configuration of an open position
  modifyPositionAdvanced(positionId, params) {
    const index = this.positions.findIndex(p => p.id === positionId);
    if (index === -1) return false;

    const pos = this.positions[index];
    const currentPrice = pos.currentPrice;

    if (params.sl !== undefined) {
      pos.sl = params.sl;
    }
    if (params.tp !== undefined) {
      pos.tp = params.tp;
    }
    if (params.tsl !== undefined) {
      pos.tsl = params.tsl;
      if (pos.tsl) {
        pos.favorablePrice = currentPrice;
      } else {
        pos.tslTriggerPrice = null;
        pos.favorablePrice = null;
      }
    }
    if (params.tpTargets !== undefined) {
      pos.tpTargets = params.tpTargets;
    }

    this.saveState();
    this.logNotification('success', 'Position Config Updated', `Advanced parameters updated.`);
    this.recalculateStats({});
    this.notify();
    return true;
  }

  // Closes an open position manually
  closePosition(positionId) {
    const index = this.positions.findIndex(p => p.id === positionId);
    if (index === -1) return false;

    const pos = this.positions.splice(index, 1)[0];
    const finalPnl = pos.pnl;
    const closeComm = pos.closeCommission || 0;
    
    this.balance += (finalPnl - closeComm);

    this.history.unshift({
      id: pos.id,
      symbol: pos.symbol,
      type: pos.type,
      leverage: pos.leverage,
      volume: pos.volume,
      entryPrice: pos.entryPrice,
      exitPrice: pos.currentPrice,
      exitReason: 'Market Close',
      commission: (pos.commission || 0) + closeComm,
      pnl: finalPnl - closeComm,
      openTime: pos.timestamp,
      closeTime: Date.now(),
      tp: pos.tp || null,
      sl: pos.sl || null,
      swap: 0,
      timestamp: Date.now()
    });

    this.saveState();
    this.logNotification('info', 'Position Closed', `Manual close of ${pos.symbol.split('/')[0]} ${pos.type}. P&L: $${(finalPnl - closeComm).toFixed(2)}`);
    this.recalculateStats({});
    this.notify();
    return true;
  }

  // Closes all open positions manually
  closeAllPositions() {
    if (this.positions.length === 0) return false;
    while (this.positions.length > 0) {
      this.closePosition(this.positions[0].id);
    }
    return true;
  }

  // Cancels a pending limit order manually
  cancelPendingOrder(orderId) {
    const index = this.pendingOrders.findIndex(o => o.id === orderId);
    if (index === -1) return false;

    const order = this.pendingOrders.splice(index, 1)[0];

    this.history.unshift({
      id: order.id,
      symbol: order.symbol,
      type: order.type,
      leverage: order.leverage,
      volume: order.volume,
      entryPrice: order.targetPrice,
      exitPrice: order.targetPrice,
      exitReason: 'Cancelled (Manual)',
      pnl: 0,
      openTime: order.timestamp,
      closeTime: Date.now(),
      tp: order.tp || null,
      sl: order.sl || null,
      swap: 0,
      timestamp: Date.now()
    });
    
    this.saveState();
    this.logNotification('info', 'Order Cancelled', `Cancelled limit order to ${order.type} ${order.symbol}`);
    this.recalculateStats({});
    this.notify();
    return true;
  }

  subscribe(callback) {
    this.listeners.push(callback);
    callback(this);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  notify() {
    this.listeners.forEach(callback => callback(this));
  }

  // Integrates with our notification callback
  registerNotificationCallback(handler) {
    this.notificationHandler = handler;
  }

  logNotification(type, title, message) {
    if (this.notificationHandler) {
      this.notificationHandler(type, title, message);
    } else {
      console.log(`[Notification - ${type}] ${title}: ${message}`);
    }
  }
}

export const tradingEngine = new TradingEngine();
