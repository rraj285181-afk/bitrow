// Trading Engine for Bitstar Crypto Demo App
// Manages positions, orders, account stats, and triggers SL/TP/liquidations

function getSpread(symbol, currentPrice) {
  const cleanSymbol = symbol.replace('/', '').replace('=X', '').replace('=F', '');
  if (cleanSymbol.includes('BTC')) return 15.00;
  if (cleanSymbol.includes('ETH')) return 1.50;
  if (cleanSymbol.includes('EUR')) return 0.00008; // 0.8 pips
  if (cleanSymbol.includes('XAU') || cleanSymbol === 'GC') return 0.25;    // 25 cents
  if (cleanSymbol.includes('XAG') || cleanSymbol === 'SI') return 0.015;   // 1.5 cents
  return 0.03; // USOIL: 3 cents
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
    this._saveDebounceTimer = null; // debounce timer for saveStateToServer
    this._heartbeatFailCount = 0;  // consecutive failures for backoff
    this._heartbeatBaseMs = 10000; // normal interval 10s
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

    // Debounce: coalesce rapid consecutive saves into a single server call (1.5s window)
    if (this._saveDebounceTimer) {
      clearTimeout(this._saveDebounceTimer);
    }
    this._saveDebounceTimer = setTimeout(() => {
      this._saveDebounceTimer = null;
      this._flushSaveToServer();
    }, 1500);
  }

  _flushSaveToServer() {
    if (!this.accountId) return;

    const state = {
      accountId: this.accountId,
      balance: this.balance,
      positions: this.positions,
      pendingOrders: this.pendingOrders,
      history: this.history
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
    // Exponential backoff heartbeat — interval doubles on each failure up to 5 minutes
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    const intervalMs = Math.min(this._heartbeatBaseMs * Math.pow(2, this._heartbeatFailCount || 0), 5 * 60 * 1000);
    this.heartbeatInterval = setTimeout(() => {
      this.heartbeatInterval = null;
      this.checkConnectionHealth();
    }, intervalMs);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearTimeout(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this._saveDebounceTimer) {
      clearTimeout(this._saveDebounceTimer);
      this._saveDebounceTimer = null;
    }
  }

  checkConnectionHealth() {
    if (!this.accountId) {
      this.startHeartbeat(); // reschedule even if no accountId
      return;
    }

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
        // Success — reset backoff counter
        this._heartbeatFailCount = 0;
        if (!this.isLoaded) {
          this.isLoaded = true;
          this.notify();
        }
        this.startHeartbeat(); // reschedule at normal interval
      })
      .catch(err => {
        // Increment backoff counter (caps at 5 to limit max interval)
        this._heartbeatFailCount = Math.min((this._heartbeatFailCount || 0) + 1, 5);
        console.warn(`Heartbeat failed (attempt ${this._heartbeatFailCount}):`, err.message);
        if (this.isLoaded) {
          this.isLoaded = false;
          this.notify();
        }
        this.startHeartbeat(); // reschedule at longer interval
      });
  }

  // No longer generating guest accounts

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
        const spreadDiff = getSpread(pos.symbol, midPrice);
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
      const spreadDiff = getSpread(order.symbol, midPrice);
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
      const spreadDiff = getSpread(order.symbol, livePrice);
      const executionPrice = order.type === 'BUY' ? livePrice + (spreadDiff / 2) : livePrice - (spreadDiff / 2);
      const marginReq = (order.volume * executionPrice) / order.leverage;
      const fee = 0; // No commission fee, spread (pips) is the only cost

      // Re-verify margin sufficiency at execution time
      if (this.freeMargin >= marginReq + fee) {
        this.balance -= fee;
        const position = {
          id: order.id,
          symbol: order.symbol,
          type: order.type,
          leverage: order.leverage,
          volume: order.volume,
          entryPrice: executionPrice,
          currentPrice: executionPrice,
          margin: marginReq,
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
        this.logNotification('success', 'Order Filled', `Limit Order filled: ${order.type} ${order.volume} ${order.symbol.split('/')[0]} @ $${livePrice.toFixed(2)}`);
        
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
        // Remove triggered targets AFTER building the partial close queue (not before)
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

        this.balance += finalPnl;
        
        this.history.unshift({
          id: pos.id,
          symbol: pos.symbol,
          type: pos.type,
          leverage: pos.leverage,
          volume: pos.volume,
          entryPrice: pos.entryPrice,
          exitPrice: closePrice,
          exitReason: reason,
          pnl: finalPnl,
          openTime: pos.timestamp,
          closeTime: Date.now(),
          tp: pos.tp || null,
          sl: pos.sl || null,
          swap: 0,
          timestamp: Date.now()
        });

        this.logNotification(finalPnl >= 0 ? 'success' : 'info', `Position Closed (${reason})`, 
          `${pos.symbol.split('/')[0]} ${pos.type} closed @ $${closePrice.toFixed(2)}. P&L: $${finalPnl.toFixed(2)}`
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
      
      this.balance += liquidatedPos.pnl;
      
      this.history.unshift({
        id: liquidatedPos.id,
        symbol: liquidatedPos.symbol,
        type: liquidatedPos.type,
        leverage: liquidatedPos.leverage,
        volume: liquidatedPos.volume,
        entryPrice: liquidatedPos.entryPrice,
        exitPrice: liquidatedPos.currentPrice,
        exitReason: 'Liquidation (Stop Out)',
        pnl: liquidatedPos.pnl,
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
    const price = targetPrice; // same value regardless of orderType; validation below
    
    // Safety checks
    if (!symbol || !type || !volume || volume <= 0 || !leverage || leverage <= 0 || isNaN(price) || price <= 0) {
      this.logNotification('error', 'Order Rejected', 'Invalid order details or market price.');
      return false;
    }
    const sizeVal = volume * price;
    const marginReq = sizeVal / leverage;
    const fee = 0; // No commission fee, spread (pips) is the only cost

    // Check if margin is sufficient
    if (this.freeMargin < marginReq + fee) {
      this.logNotification('error', 'Margin Warning', 'Insufficient Free Margin + fees to open this position.');
      return false;
    }

    const orderId = 'ord_' + Math.random().toString(36).substring(2, 11);

    if (orderType === 'MARKET') {
      // Execute immediately
      this.balance -= fee;
      
      const newPosition = {
        id: orderId,
        symbol,
        type,
        leverage,
        volume,
        entryPrice: price,
        currentPrice: price,
        margin: marginReq,
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
      this.logNotification('success', 'Order Executed', `Opened ${type} ${volume} ${symbol.split('/')[0]} @ $${price.toFixed(2)}`);
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
      this.logNotification('info', 'Limit Order Placed', `Set Limit ${type} ${volume} ${symbol.split('/')[0]} @ $${price.toFixed(2)}`);
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

    this.balance += closedPnl;

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
      pnl: closedPnl,
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

    this.saveState();
    this.logNotification('success', 'Partial Close Executed', `Closed ${(closeVolume / getLotMultiplier(pos.symbol)).toFixed(2)} lots of ${pos.symbol.split('/')[0]}. P&L: $${closedPnl.toFixed(2)}`);
    
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
    
    this.balance += finalPnl;

    this.history.unshift({
      id: pos.id,
      symbol: pos.symbol,
      type: pos.type,
      leverage: pos.leverage,
      volume: pos.volume,
      entryPrice: pos.entryPrice,
      exitPrice: pos.currentPrice,
      exitReason: 'Market Close',
      pnl: finalPnl,
      openTime: pos.timestamp,
      closeTime: Date.now(),
      tp: pos.tp || null,
      sl: pos.sl || null,
      swap: 0,
      timestamp: Date.now()
    });

    this.saveState();
    this.logNotification('info', 'Position Closed', `Manual close of ${pos.symbol.split('/')[0]} ${pos.type}. P&L: $${finalPnl.toFixed(2)}`);
    this.recalculateStats({});
    this.notify();
    return true;
  }

  // Closes all open positions manually (batch - single save instead of N saves)
  closeAllPositions() {
    if (this.positions.length === 0) return false;
    // Close all at once without saving on each iteration
    while (this.positions.length > 0) {
      const pos = this.positions.splice(0, 1)[0];
      const finalPnl = pos.pnl;
      this.balance += finalPnl;
      this.history.unshift({
        id: pos.id,
        symbol: pos.symbol,
        type: pos.type,
        leverage: pos.leverage,
        volume: pos.volume,
        entryPrice: pos.entryPrice,
        exitPrice: pos.currentPrice,
        exitReason: 'Market Close',
        pnl: finalPnl,
        openTime: pos.timestamp,
        closeTime: Date.now(),
        tp: pos.tp || null,
        sl: pos.sl || null,
        swap: 0,
        timestamp: Date.now()
      });
      this.logNotification('info', 'Position Closed', `Manual close of ${pos.symbol.split('/')[0]} ${pos.type}. P&L: $${finalPnl.toFixed(2)}`);
    }
    // Single save for all closed positions
    this.recalculateStats({});
    this.saveState();
    this.notify();
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
