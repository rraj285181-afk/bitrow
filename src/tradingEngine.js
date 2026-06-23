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

class TradingEngine {
  constructor() {
    this.storageKey = 'bitstar_demo_account_v1';
    this.listeners = [];
    this.loadState();
  }

  // Load from localStorage or initialize defaults
  loadState() {
    const saved = localStorage.getItem(this.storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.accountId = parsed.accountId || this.generateAccountId();
        this.balance = parseFloat(parsed.balance) || 10000.00;
        this.positions = parsed.positions || [];
        this.pendingOrders = parsed.pendingOrders || [];
        this.history = parsed.history || [];
      } catch (e) {
        console.error("Failed to parse trading state, resetting to defaults", e);
        this.resetDefaults();
      }
    } else {
      this.resetDefaults();
    }
    this.recalculateStats({});
  }

  resetDefaults() {
    this.accountId = this.generateAccountId();
    this.balance = 10000.00;
    this.positions = [];
    this.pendingOrders = [];
    this.history = [];
  }

  saveState() {
    const state = {
      accountId: this.accountId,
      balance: this.balance,
      positions: this.positions,
      pendingOrders: this.pendingOrders,
      history: this.history
    };
    localStorage.setItem(this.storageKey, JSON.stringify(state));
  }

  generateAccountId() {
    return 'Demo #' + Math.floor(100000 + Math.random() * 900000);
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
      if (priceInfo) {
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

      // Calculate P&L: Buy profit = (current - entry) * volume; Sell profit = (entry - current) * volume
      if (pos.type === 'BUY') {
        pos.pnl = (pos.currentPrice - pos.entryPrice) * pos.volume;
      } else {
        pos.pnl = (pos.entryPrice - pos.currentPrice) * pos.volume;
      }

      totalPnl += pos.pnl;
      totalMargin += pos.margin;
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
          timestamp: Date.now()
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
          reason = 'Stop Loss';
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
          reason = 'Stop Loss';
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

    if (stateChanged) {
      this.saveState();
    }

    // Always trigger UI update so ticking values refresh
    this.notify();
  }

  // Executes a new Market or Limit Order
  placeOrder(orderParams) {
    const { symbol, type, orderType, targetPrice, volume, leverage, tp, sl } = orderParams;
    
    // Safety checks
    if (!symbol || !type || !volume || volume <= 0 || !leverage || leverage <= 0) {
      this.logNotification('error', 'Order Rejected', 'Invalid order details provided.');
      return false;
    }

    const price = orderType === 'MARKET' ? targetPrice : targetPrice;
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
        timestamp: Date.now()
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
