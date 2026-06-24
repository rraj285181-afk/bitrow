import './style.css';
import { createChart, CandlestickSeries, HistogramSeries, AreaSeries, BarSeries, LineSeries } from 'lightweight-charts';
import { marketEngine } from './mockMarket';
import { tradingEngine } from './tradingEngine';

// Global state
let activeSymbol = 'EURUSD';
let activeTimeframe = 5; // 5m default like in screenshot
let currentOrderType = 'MARKET'; // 'MARKET' or 'LIMIT'
let isBuyActive = null; // BUY, SELL, or null (neutral)
let lotSizeValue = 0.01;

// Chart references
let chart = null;
let candlestickSeries = null;
let areaSeries = null;
let barSeries = null;
let volumeSeries = null;
let activeChartPriceLines = []; // open orders/positions price lines
let isPickingTp = false;
let isPickingSl = false;
let tempTpLine = null;
let tempSlLine = null;

// New chart features state
let currentChartType = 'candles'; // 'candles', 'line', 'bars'
let isVolumeVisible = true;
let enabledIndicators = { ema9: false, ema21: false, bb: false };
let ema9Series = null;
let ema21Series = null;
let bbUpperSeries = null;
let bbBasisSeries = null;
let bbLowerSeries = null;
let drawings = [];
let activeDrawingTool = null; // 'trendline', 'channel', 'gannfan', 'fib', 'brush', 'text', 'emoji', 'ruler', 'zoom', or null
let drawingStartPoint = null;
let currentHoverPoint = null;
let isMagnetMode = false;
let isStayInDrawingMode = false;
let isDrawingsLocked = false;
let isDrawingsHidden = false;
let lastSeenHistoryVersion = {};

// Initialize when DOM loaded
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  // Register notification bridge
  tradingEngine.registerNotificationCallback(showToast);

  // Initialize UI Bindings
  initAssetTabs();
  initTimeframes();
  initTradingForm();
  initChart();
  startLiveClock();
  startLatencySimulator();
  
  // Initialize drawing toolbar collapsible drawer
  const collapseBtn = document.getElementById('drawing-toolbar-collapse-btn');
  const drawingToolbar = document.getElementById('drawing-toolbar');
  const chartWrapper = document.querySelector('.chart-wrapper');
  
  if (collapseBtn && drawingToolbar && chartWrapper) {
    if (window.innerWidth <= 768) {
      drawingToolbar.classList.add('collapsed');
      chartWrapper.classList.add('toolbar-collapsed');
    }
    
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      drawingToolbar.classList.toggle('collapsed');
      chartWrapper.classList.toggle('toolbar-collapsed');
      
      if (chart) {
        const container = document.getElementById('chart-container');
        if (container) {
          chart.resize(container.clientWidth, container.clientHeight);
          const canvas = document.getElementById('chart-drawing-canvas');
          if (canvas) {
            canvas.width = container.clientWidth;
            canvas.height = container.clientHeight;
            drawCanvas();
          }
        }
      }
    });
  }
  
  // Instruments panel bindings
  const instrumentsBtn = document.getElementById('sidebar-btn-instruments');
  const instrumentsPanel = document.getElementById('instruments-sidebar-panel');
  if (instrumentsBtn && instrumentsPanel) {
    instrumentsBtn.addEventListener('click', () => {
      instrumentsPanel.classList.toggle('hidden');
      if (!instrumentsPanel.classList.contains('hidden')) {
        renderInstrumentsList();
      }
    });
  }

  // Settings modal bindings
  const settingsBtn = document.getElementById('sidebar-btn-settings');
  const settingsModal = document.getElementById('settings-modal');
  const closeSettingsBtn = document.getElementById('close-settings-btn');
  const toggleVolumeSetting = document.getElementById('toggle-volume-setting');

  if (settingsBtn && settingsModal) {
    settingsBtn.addEventListener('click', () => {
      settingsModal.classList.remove('hidden');
      if (toggleVolumeSetting) {
        toggleVolumeSetting.checked = isVolumeVisible;
      }
    });
  }

  if (closeSettingsBtn && settingsModal) {
    closeSettingsBtn.addEventListener('click', () => {
      settingsModal.classList.add('hidden');
    });
  }

  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        settingsModal.classList.add('hidden');
      }
    });
  }

  if (toggleVolumeSetting) {
    toggleVolumeSetting.addEventListener('change', (e) => {
      isVolumeVisible = e.target.checked;
      if (volumeSeries) {
        volumeSeries.applyOptions({ visible: isVolumeVisible });
      }
      
      const saved = localStorage.getItem('bitstar_chart_layout');
      let layout = {};
      if (saved) {
        try {
          layout = JSON.parse(saved);
        } catch (err) {}
      }
      layout.volumeVisible = isVolumeVisible;
      localStorage.setItem('bitstar_chart_layout', JSON.stringify(layout));
      
      showToast('info', 'Settings Updated', `Volume display turned ${isVolumeVisible ? 'ON' : 'OFF'}.`);
    });
  }

  const searchInput = document.getElementById('instruments-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      filterInstrumentsList();
    });
  }

  const filterBtns = document.querySelectorAll('#instruments-sidebar-panel .filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      filterBtns.forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      filterInstrumentsList();
    });
  });

  // Subscribe to changes
  marketEngine.subscribe(handleMarketTick);
  tradingEngine.subscribe(handleTradingTick);

  // Reset demo account button
  const resetBtn = document.getElementById('reset-account-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      tradingEngine.resetAccount();
      showToast('success', 'Account Reset', 'Demo account balance reset to $10,000.00 USD.');
    });
  }

  // Close all positions button
  const closeAllBtn = document.getElementById('close-all-positions-btn');
  if (closeAllBtn) {
    closeAllBtn.addEventListener('click', () => {
      const closedCount = tradingEngine.positions.length;
      if (closedCount > 0) {
        tradingEngine.closeAllPositions();
        showToast('info', 'Positions Closed', `Closed all ${closedCount} active positions.`);
      } else {
        showToast('info', 'No Positions', 'There are no active positions to close.');
      }
    });
  }
}

// ----------------------------------------------------
// UI Notification Toast
// ----------------------------------------------------
function showToast(type, title, message) {
  const container = document.getElementById('notifications-wrapper');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = document.createElement('div');
  icon.className = 'toast-icon';
  icon.textContent = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';

  const content = document.createElement('div');
  content.className = 'toast-content';

  const titleEl = document.createElement('div');
  titleEl.className = 'toast-title';
  titleEl.textContent = title;

  const msgEl = document.createElement('div');
  msgEl.className = 'toast-message';
  msgEl.textContent = message;

  content.appendChild(titleEl);
  content.appendChild(msgEl);
  toast.appendChild(icon);
  toast.appendChild(content);

  container.appendChild(toast);

  // Animate in
  setTimeout(() => {
    toast.classList.add('show');
  }, 30);

  // Auto-remove
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
    }, 200);
  }, 4000);
}

// ----------------------------------------------------
// Asset Tab Switches
// ----------------------------------------------------
function initAssetTabs() {
  const tabs = document.querySelectorAll('.asset-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      const targetSymbol = e.currentTarget.getAttribute('data-symbol');
      switchAsset(targetSymbol, e.currentTarget);
    });

    const closeBtn = tab.querySelector('.tab-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        handleCloseTab(tab);
      });
    }
  });

  // Hook up the '+' button to toggle instruments panel
  const addTabBtn = document.querySelector('.add-tab-btn');
  if (addTabBtn) {
    addTabBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const instrumentsPanel = document.getElementById('instruments-sidebar-panel');
      if (instrumentsPanel) {
        instrumentsPanel.classList.toggle('hidden');
        if (!instrumentsPanel.classList.contains('hidden')) {
          renderInstrumentsList();
        }
      }
    });
  }

  // Hook up overlay "Browse Instruments" button
  const overlayBtn = document.getElementById('open-instruments-overlay-btn');
  if (overlayBtn) {
    overlayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const instrumentsPanel = document.getElementById('instruments-sidebar-panel');
      if (instrumentsPanel) {
        instrumentsPanel.classList.remove('hidden');
        renderInstrumentsList();
      }
    });
  }
}

function handleCloseTab(tabElement) {
  const wasActive = tabElement.classList.contains('active');
  const tabs = Array.from(document.querySelectorAll('.asset-tab'));
  const index = tabs.indexOf(tabElement);
  
  let siblingTab = null;
  if (index !== -1) {
    if (index < tabs.length - 1) {
      siblingTab = tabs[index + 1];
    } else if (index > 0) {
      siblingTab = tabs[index - 1];
    }
  }

  tabElement.remove();

  if (wasActive) {
    if (siblingTab) {
      const nextSymbol = siblingTab.getAttribute('data-symbol');
      switchAsset(nextSymbol, siblingTab);
    } else {
      updateWorkspaceState();
    }
  } else {
    updateWorkspaceState();
  }
}

function updateWorkspaceState() {
  const tabs = document.querySelectorAll('.asset-tab');
  const hasTabs = tabs.length > 0;
  
  const noTabsOverlay = document.getElementById('no-tabs-overlay');
  const rightWorkspace = document.querySelector('.right-workspace');
  const titleBar = rightWorkspace.querySelector('.terminal-title-bar');
  const panelForm = rightWorkspace.querySelector('.panel-form');
  const placeholder = rightWorkspace.querySelector('.no-symbol-placeholder');
  
  if (hasTabs) {
    if (noTabsOverlay) noTabsOverlay.classList.add('hidden');
    if (titleBar) titleBar.classList.remove('hidden');
    if (panelForm) panelForm.classList.remove('hidden');
    if (placeholder) placeholder.classList.add('hidden');
  } else {
    activeSymbol = null;
    if (noTabsOverlay) noTabsOverlay.classList.remove('hidden');
    if (titleBar) titleBar.classList.add('hidden');
    if (panelForm) panelForm.classList.add('hidden');
    if (placeholder) placeholder.classList.remove('hidden');
    
    // Clear metrics inside the chart info bar
    const chartInfoSymbol = document.getElementById('chart-info-symbol');
    const chartInfoMetrics = document.getElementById('chart-info-metrics');
    if (chartInfoSymbol) chartInfoSymbol.innerHTML = `<span style="font-weight: 700; color: var(--text-secondary);">No Active Asset</span>`;
    if (chartInfoMetrics) chartInfoMetrics.innerHTML = '';
    
    // Clear chart series
    reloadChartData();
  }
}


function switchAsset(symbol, tabElement) {
  if (activeSymbol === symbol) {
    document.querySelectorAll('.asset-tab').forEach(t => t.classList.remove('active'));
    tabElement.classList.add('active');
    updateWorkspaceState();
    return;
  }
  activeSymbol = symbol;
  
  // Toggle active tab class
  document.querySelectorAll('.asset-tab').forEach(t => t.classList.remove('active'));
  tabElement.classList.add('active');
  updateWorkspaceState();

  // Update terminal symbol displays to match tab text exactly (e.g. BTC, EUR/USD)
  const symbolText = tabElement.querySelector('.tab-symbol-text').textContent;
  document.getElementById('terminal-active-symbol').textContent = symbolText;

  const coinIconText = tabElement.querySelector('.coin-icon').textContent;
  const coinColor = tabElement.querySelector('.coin-icon').style.color;
  const terminalIcon = document.getElementById('terminal-active-icon');
  if (terminalIcon) {
    terminalIcon.textContent = coinIconText;
    terminalIcon.style.backgroundColor = coinColor;
  }

  // Reset Form
  lotSizeValue = 1.00;
  document.getElementById('order-volume-input').value = lotSizeValue.toFixed(2);
  
  // Reset TP and SL inputs
  document.getElementById('tp-price-input').value = '';
  document.getElementById('sl-price-input').value = '';

  // Reset Buy/Sell selection
  isBuyActive = null;
  const sellTrigger = document.getElementById('action-sell-trigger');
  const buyTrigger = document.getElementById('action-buy-trigger');
  if (sellTrigger) sellTrigger.classList.remove('active');
  if (buyTrigger) buyTrigger.classList.remove('active');
  executeUpdateButtonUI();

  // Cancel picker states
  isPickingTp = false;
  isPickingSl = false;
  const tpPicker = document.getElementById('tp-chart-picker');
  const slPicker = document.getElementById('sl-chart-picker');
  if (tpPicker) tpPicker.classList.remove('picking');
  if (slPicker) slPicker.classList.remove('picking');
  const chartContainer = document.getElementById('chart-container');
  if (chartContainer) chartContainer.style.cursor = 'default';

  // Clear temporary lines
  clearTempPriceLines();

  // Reload Chart Data
  reloadChartData();
  updateOrderCalculations();
}

function getMappedSymbol() {
  if (!activeSymbol) return 'EUR/USDT';
  if (activeSymbol.startsWith('BTC')) return 'BTC/USDT';
  if (activeSymbol.startsWith('ETH')) return 'ETH/USDT';
  if (activeSymbol.startsWith('EUR')) return 'EUR/USDT';
  if (activeSymbol.startsWith('XAU')) return 'XAU/USDT';
  if (activeSymbol.startsWith('XAG')) return 'XAG/USDT';
  return 'USOIL/USDT'; // USOIL
}

function getLotMultiplier() {
  if (!activeSymbol) return 1.0;
  if (activeSymbol.startsWith('BTC')) return 1.0;     // 1 BTC per lot
  if (activeSymbol.startsWith('ETH')) return 10.0;    // 10 ETH per lot
  if (activeSymbol.startsWith('EUR')) return 100000.0; // 100,000 EUR per lot
  if (activeSymbol.startsWith('XAU')) return 100.0;    // 100 oz of Gold per lot
  if (activeSymbol.startsWith('XAG')) return 5000.0;   // 5,000 oz of Silver per lot
  return 1000.0; // USOIL: 1,000 barrels per lot
}

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
  if (cleanSymbol.includes('XAG') || cleanSymbol === 'SI') return 0.01;
  return 0.01; // USOIL: 0.01
}

// ----------------------------------------------------
// Chart Setup
// ----------------------------------------------------
// ----------------------------------------------------
// Chart Setup
// ----------------------------------------------------
function initChart() {
  const container = document.getElementById('chart-container');
  if (!container) return;

  container.replaceChildren();

  const initialWidth = container.clientWidth || 600;
  const initialHeight = container.clientHeight || 400;

  chart = createChart(container, {
    width: initialWidth,
    height: initialHeight,
    layout: {
      background: { color: 'transparent' },
      textColor: '#e2e8f0',
      fontSize: 10,
      fontFamily: 'Inter, sans-serif'
    },
    grid: {
      vertLines: { color: 'rgba(255, 255, 255, 0.02)' },
      horzLines: { color: 'rgba(255, 255, 255, 0.02)' }
    },
    crosshair: {
      mode: 0,
      vertLine: { color: '#ffb700', width: 1, style: 3 },
      horzLine: { color: '#ffb700', width: 1, style: 3 }
    },
    rightPriceScale: {
      borderColor: '#1e2533',
      autoScale: true,
      entireTextOnly: true,
      scaleMargins: { top: 0.1, bottom: 0.2 }
    },
    timeScale: {
      borderColor: '#1e2533',
      timeVisible: true,
      secondsVisible: false
    }
  });

  // Series 1: Candlesticks (default)
  candlestickSeries = chart.addSeries(CandlestickSeries, {
    upColor: '#1080ff',
    downColor: '#e25241',
    borderUpColor: '#1080ff',
    borderDownColor: '#e25241',
    wickUpColor: '#1080ff',
    wickDownColor: '#e25241',
    priceLineColor: '#1080ff',
    priceLineWidth: 1.5,
    priceLineStyle: 0 // Solid
  });

  // Series 2: Area / Line Series
  areaSeries = chart.addSeries(AreaSeries, {
    topColor: 'rgba(16, 128, 255, 0.35)',
    bottomColor: 'rgba(16, 128, 255, 0.0)',
    lineColor: '#1080ff',
    lineWidth: 2,
    priceLineColor: '#1080ff',
    priceLineWidth: 1.5,
    priceLineStyle: 0,
    visible: false
  });

  // Series 3: OHLC Bar Series
  barSeries = chart.addSeries(BarSeries, {
    upColor: '#1080ff',
    downColor: '#e25241',
    priceLineColor: '#1080ff',
    priceLineWidth: 1.5,
    priceLineStyle: 0,
    visible: false
  });

  // Technical Indicators Series
  ema9Series = chart.addSeries(LineSeries, {
    color: '#ffd60a', // gold/yellow
    lineWidth: 1.5,
    priceLineVisible: false,
    lastValueVisible: false,
    visible: false,
    title: 'EMA 9'
  });

  ema21Series = chart.addSeries(LineSeries, {
    color: '#0a84ff', // cyan/blue
    lineWidth: 1.5,
    priceLineVisible: false,
    lastValueVisible: false,
    visible: false,
    title: 'EMA 21'
  });

  bbUpperSeries = chart.addSeries(LineSeries, {
    color: '#bf5af2', // purple upper band
    lineWidth: 1,
    lineStyle: 2, // dashed
    priceLineVisible: false,
    lastValueVisible: false,
    visible: false,
    title: 'BB Upper'
  });

  bbBasisSeries = chart.addSeries(LineSeries, {
    color: '#8a99ad', // grey basis
    lineWidth: 1,
    lineStyle: 3, // dotted
    priceLineVisible: false,
    lastValueVisible: false,
    visible: false,
    title: 'BB Basis'
  });

  bbLowerSeries = chart.addSeries(LineSeries, {
    color: '#bf5af2', // purple lower band
    lineWidth: 1,
    lineStyle: 2, // dashed
    priceLineVisible: false,
    lastValueVisible: false,
    visible: false,
    title: 'BB Lower'
  });

  volumeSeries = chart.addSeries(HistogramSeries, {
    color: '#19202e',
    priceFormat: { type: 'volume' },
    priceScaleId: '', 
    scaleMargins: { top: 0.82, bottom: 0 },
    priceLineVisible: false,
    lastValueVisible: false,
    visible: isVolumeVisible
  });

  chart.priceScale('').applyOptions({
    scaleMargins: { top: 0.82, bottom: 0 }
  });

  // Initialize dropdown toggle listeners, drawing bindings, and load saved layout
  initChartUIPanels();
  loadSavedLayout();
  reloadChartData();

  const resizeObserver = new ResizeObserver(entries => {
    if (entries.length === 0) return;
    const { width, height } = entries[0].contentRect;
    if (width > 0 && height > 0) {
      window.requestAnimationFrame(() => {
        chart.resize(width, height);
        const canvas = document.getElementById('chart-drawing-canvas');
        if (canvas) {
          canvas.width = width;
          canvas.height = height;
          drawCanvas();
        }
      });
    }
  });
  resizeObserver.observe(container);

  // Subscribe to clicks on chart for picking TP/SL price and drawing tools
  chart.subscribeClick((param) => {
    if (!param || !param.point) return;
    
    const activeSeries = getActiveSeries();
    if (!activeSeries) return;
    
    let price = activeSeries.coordinateToPrice(param.point.y);
    if (!price) return;

    const coin = marketEngine.coins[getMappedSymbol()];
    const dec = coin ? coin.decimalPlaces : 2;
    let formattedPrice = parseFloat(price.toFixed(dec));

    // Handle TP picking
    if (isPickingTp) {
      document.getElementById('tp-price-input').value = formattedPrice;
      isPickingTp = false;
      document.getElementById('tp-chart-picker').classList.remove('picking');
      container.style.cursor = 'default';
      updateTempTpLine(formattedPrice);
      updateOrderCalculations();
      showToast('success', 'Take Profit Set', `TP price set to ${formattedPrice} from chart.`);
      return;
    }
    
    // Handle SL picking
    if (isPickingSl) {
      document.getElementById('sl-price-input').value = formattedPrice;
      isPickingSl = false;
      document.getElementById('sl-chart-picker').classList.remove('picking');
      container.style.cursor = 'default';
      updateTempSlLine(formattedPrice);
      updateOrderCalculations();
      showToast('success', 'Stop Loss Set', `SL price set to ${formattedPrice} from chart.`);
      return;
    }

    // Magnet mode snapping
    if (isMagnetMode && param.time) {
      const keySymbol = getMappedSymbol();
      const history = marketEngine.getHistory(keySymbol, activeTimeframe);
      const candle = history.find(c => c.time === param.time);
      if (candle) {
        const prices = [candle.open, candle.high, candle.low, candle.close];
        let closestPrice = prices[0];
        let minDiff = Math.abs(price - closestPrice);
        for (let i = 1; i < prices.length; i++) {
          const diff = Math.abs(price - prices[i]);
          if (diff < minDiff) {
            minDiff = diff;
            closestPrice = prices[i];
          }
        }
        price = closestPrice;
        formattedPrice = parseFloat(price.toFixed(dec));
      }
    }

    // Handle Drawings click
    if (activeDrawingTool) {
      if (isDrawingsLocked) {
        showToast('error', 'Drawings Locked', 'Please unlock drawings first.');
        return;
      }

      // One-click tools: text, emoji
      if (activeDrawingTool === 'text') {
        const msg = prompt("Enter text annotation:");
        if (msg) {
          drawings.push({
            type: 'text',
            start: { time: param.time, price: price },
            text: msg
          });
          showToast('success', 'Text Created', 'Text annotation added to chart.');
          drawCanvas();
        }
        if (!isStayInDrawingMode) {
          setDrawingTool(null, document.getElementById('draw-btn-crosshair'));
        }
        return;
      }

      if (activeDrawingTool === 'emoji') {
        const emoji = prompt("Enter Emoji sticker (e.g. 🚀, 🔥, 📈, 📉, ⚠️):", "🚀");
        if (emoji) {
          drawings.push({
            type: 'emoji',
            start: { time: param.time, price: price },
            emoji: emoji
          });
          showToast('success', 'Emoji Added', 'Emoji sticker added to chart.');
          drawCanvas();
        }
        if (!isStayInDrawingMode) {
          setDrawingTool(null, document.getElementById('draw-btn-crosshair'));
        }
        return;
      }

      // Two-click tools
      if (!drawingStartPoint) {
        drawingStartPoint = {
          time: param.time,
          price: price,
          x: param.point.x,
          y: param.point.y
        };
        const toolNameMap = {
          trendline: 'Trend Line',
          channel: 'Parallel Channel',
          gannfan: 'Gann Fan',
          fib: 'Fibonacci Retracement',
          brush: 'Highlight Brush',
          ruler: 'Ruler',
          zoom: 'Zoom Area'
        };
        showToast('info', 'Start Point Set', `Click again to place the endpoint of your ${toolNameMap[activeDrawingTool] || activeDrawingTool}.`);
      } else {
        const endPoint = {
          time: param.time,
          price: price
        };
        
        if (activeDrawingTool === 'zoom') {
          // Zoom in
          const timeScale = chart.timeScale();
          const log1 = timeScale.timeToCoordinate(drawingStartPoint.time);
          const log2 = timeScale.timeToCoordinate(endPoint.time);
          if (log1 !== null && log2 !== null) {
            const logicalRange = {
              from: timeScale.coordinateToLogical(Math.min(log1, log2)),
              to: timeScale.coordinateToLogical(Math.max(log1, log2))
            };
            timeScale.setVisibleLogicalRange(logicalRange);
            showToast('success', 'Zoom Applied', 'Chart zoomed to selected area.');
          }
        } else {
          // Push to drawings
          drawings.push({
            type: activeDrawingTool,
            start: { time: drawingStartPoint.time, price: drawingStartPoint.price },
            end: endPoint
          });
          
          const toolNameMap = {
            trendline: 'Trend Line',
            channel: 'Parallel Channel',
            gannfan: 'Gann Fan',
            fib: 'Fibonacci Retracement',
            brush: 'Highlight Brush',
            ruler: 'Ruler'
          };
          showToast('success', 'Drawing Created', `${toolNameMap[activeDrawingTool] || activeDrawingTool} added to chart.`);
        }
        
        // Reset states
        const prevTool = activeDrawingTool;
        drawingStartPoint = null;
        
        if (!isStayInDrawingMode) {
          setDrawingTool(null, document.getElementById('draw-btn-crosshair'));
        } else {
          const toolNameMap = {
            trendline: 'Trend Line',
            channel: 'Parallel Channel',
            gannfan: 'Gann Fan',
            fib: 'Fibonacci Retracement',
            brush: 'Highlight Brush',
            ruler: 'Ruler',
            zoom: 'Zoom Area'
          };
          showToast('info', 'Drawing Mode Active', `Click on the chart to start drawing another ${toolNameMap[prevTool] || prevTool}.`);
        }
        
        drawCanvas();
      }
    }
  });

  // Subscribe to crosshair move for drawing preview
  chart.subscribeCrosshairMove((param) => {
    if (!param || !param.point) return;
    
    const activeSeries = getActiveSeries();
    if (!activeSeries) return;
    
    let price = activeSeries.coordinateToPrice(param.point.y);
    if (!price) return;

    if (isMagnetMode && param.time) {
      const keySymbol = getMappedSymbol();
      const history = marketEngine.getHistory(keySymbol, activeTimeframe);
      const candle = history.find(c => c.time === param.time);
      if (candle) {
        const prices = [candle.open, candle.high, candle.low, candle.close];
        let closestPrice = prices[0];
        let minDiff = Math.abs(price - closestPrice);
        for (let i = 1; i < prices.length; i++) {
          const diff = Math.abs(price - prices[i]);
          if (diff < minDiff) {
            minDiff = diff;
            closestPrice = prices[i];
          }
        }
        price = closestPrice;
      }
    }
    
    currentHoverPoint = {
      time: param.time,
      price: price,
      x: param.point.x,
      y: param.point.y
    };
    
    if (drawingStartPoint) {
      drawCanvas();
    }
  });

  // Redraw when the timescale changes (scroll, zoom)
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
    drawCanvas();
  });

  const loader = document.getElementById('chart-loader');
  if (loader) loader.classList.add('hidden');
}

function reloadChartData() {
  if (!candlestickSeries || !volumeSeries || !areaSeries || !barSeries) return;

  if (!activeSymbol) {
    candlestickSeries.setData([]);
    areaSeries.setData([]);
    barSeries.setData([]);
    volumeSeries.setData([]);
    
    candlestickSeries.applyOptions({ priceLineVisible: false, lastValueVisible: false });
    areaSeries.applyOptions({ priceLineVisible: false, lastValueVisible: false });
    barSeries.applyOptions({ priceLineVisible: false, lastValueVisible: false });

    if (ema9Series) ema9Series.setData([]);
    if (ema21Series) ema21Series.setData([]);
    if (bbUpperSeries) bbUpperSeries.setData([]);
    if (bbBasisSeries) bbBasisSeries.setData([]);
    if (bbLowerSeries) bbLowerSeries.setData([]);
    return;
  }

  const keySymbol = getMappedSymbol();
  
  // Set correct price precision for the active asset series on the chart scale to prevent clipping
  const coin = marketEngine.coins[keySymbol];
  if (coin) {
    lastSeenHistoryVersion[keySymbol] = coin.historyVersion || 0;
  }
  const precision = coin ? coin.decimalPlaces : 2;
  const priceFormatOpts = {
    type: 'price',
    precision: precision,
    minMove: 1 / Math.pow(10, precision)
  };
  
  candlestickSeries.applyOptions({ priceFormat: priceFormatOpts });
  areaSeries.applyOptions({ priceFormat: priceFormatOpts });
  barSeries.applyOptions({ priceFormat: priceFormatOpts });

  const history = marketEngine.getHistory(keySymbol, activeTimeframe);

  const loader = document.getElementById('chart-loader');
  if (loader) {
    if (history.length === 0) {
      loader.classList.remove('hidden');
    } else {
      loader.classList.add('hidden');
    }
  }

  const candles = history.map(c => ({
    time: c.time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close
  }));

  const volumes = history.map(c => ({
    time: c.time,
    value: c.volume,
    color: c.close >= c.open ? 'rgba(16, 128, 255, 0.12)' : 'rgba(226, 82, 65, 0.12)'
  }));

  candlestickSeries.setData(candles);
  areaSeries.setData(candles.map(c => ({ time: c.time, value: c.close })));
  barSeries.setData(candles);
  volumeSeries.setData(volumes);

  // Indicators calculations
  if (enabledIndicators.ema9) {
    ema9Series.setData(calculateEMA(candles, 9));
  }
  if (enabledIndicators.ema21) {
    ema21Series.setData(calculateEMA(candles, 21));
  }
  if (enabledIndicators.bb) {
    const bb = calculateBollingerBands(candles, 20);
    bbUpperSeries.setData(bb.upper);
    bbBasisSeries.setData(bb.basis);
    bbLowerSeries.setData(bb.lower);
  }

  // Redraw custom drawings
  drawCanvas();
}

function initTimeframes() {
  const container = document.querySelector('.timeframe-select-container');
  const dropdown = document.getElementById('timeframe-dropdown-menu');
  const label = document.getElementById('timeframe-label');
  
  if (container && dropdown) {
    container.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
    });
    
    document.addEventListener('click', () => {
      dropdown.classList.add('hidden');
    });
  }

  const options = document.querySelectorAll('.tf-option');
  options.forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      options.forEach(o => o.classList.remove('active'));
      e.target.classList.add('active');
      activeTimeframe = parseInt(e.target.getAttribute('data-tf'));
      label.textContent = e.target.textContent;
      dropdown.classList.add('hidden');
      reloadChartData();
    });
  });

  // Range buttons at bottom of the chart
  const rangeBtns = document.querySelectorAll('.tf-btn');
  rangeBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      rangeBtns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      
      const range = e.target.getAttribute('data-tf');
      let mappedTf = 15;
      if (range === '1d') mappedTf = 5;
      else if (range === '5d') mappedTf = 15;
      else if (range === '1m' || range === '3m') mappedTf = 60;
      else mappedTf = 1440; // 6m, 1y, 5y
      
      activeTimeframe = mappedTf;
      label.textContent = mappedTf >= 60 ? (mappedTf === 1440 ? '1d' : '1h') : mappedTf + 'm';
      
      // Update active state in timeframe dropdown options
      options.forEach(o => {
        if (parseInt(o.getAttribute('data-tf')) === mappedTf) {
          o.classList.add('active');
        } else {
          o.classList.remove('active');
        }
      });
      
      reloadChartData();
    });
  });
}

function startLiveClock() {
  const clockEl = document.getElementById('chart-live-time');
  if (!clockEl) return;
  setInterval(() => {
    const now = new Date();
    const utcStr = now.toISOString().substr(11, 8); // "HH:MM:SS"
    clockEl.textContent = `${utcStr} UTC`;
  }, 1000);
}

function startLatencySimulator() {
  const latencyEl = document.querySelector('#latency-indicator span');
  if (!latencyEl) return;
  // Set initial value
  latencyEl.textContent = '35 ms';
  setInterval(() => {
    const lat = Math.floor(Math.random() * 20) + 30; // 30-50ms
    latencyEl.textContent = `${lat} ms`;
  }, 3000);
}


// ----------------------------------------------------
// Bitstar Trading Form Mechanics
// ----------------------------------------------------
function initTradingForm() {
  const sellTriggerBox = document.getElementById('action-sell-trigger');
  const buyTriggerBox = document.getElementById('action-buy-trigger');
  
  const execMarketBtn = document.getElementById('exec-tab-market');
  const execPendingBtn = document.getElementById('exec-tab-pending');
  const executeBtn = document.getElementById('execute-btn');
  
  const pendingPriceGroup = document.getElementById('pending-price-group');
  const pendingPriceInput = document.getElementById('pending-price-input');
  
  const volumeInput = document.getElementById('order-volume-input');
  
  // On load, confirm button is hidden and neither is active
  isBuyActive = null;
  if (sellTriggerBox) sellTriggerBox.classList.remove('active');
  if (buyTriggerBox) buyTriggerBox.classList.remove('active');
  executeUpdateButtonUI();

  // Split buy/sell triggers
  sellTriggerBox.addEventListener('click', () => {
    isBuyActive = false;
    sellTriggerBox.classList.add('active');
    buyTriggerBox.classList.remove('active');
    executeUpdateButtonUI();
    updateOrderCalculations();
  });

  buyTriggerBox.addEventListener('click', () => {
    isBuyActive = true;
    buyTriggerBox.classList.add('active');
    sellTriggerBox.classList.remove('active');
    executeUpdateButtonUI();
    updateOrderCalculations();
  });

  // Market vs Pending switchers
  execMarketBtn.addEventListener('click', () => {
    currentOrderType = 'MARKET';
    execMarketBtn.classList.add('active');
    execPendingBtn.classList.remove('active');
    pendingPriceGroup.classList.add('hidden');
    updateOrderCalculations();
  });

  execPendingBtn.addEventListener('click', () => {
    currentOrderType = 'LIMIT';
    execPendingBtn.classList.add('active');
    execMarketBtn.classList.remove('active');
    pendingPriceGroup.classList.remove('hidden');
    
    if (!pendingPriceInput.value) {
      const coin = marketEngine.coins[getMappedSymbol()];
      pendingPriceInput.value = coin.currentPrice.toFixed(coin.decimalPlaces);
    }
    updateOrderCalculations();
  });

  pendingPriceInput.addEventListener('input', updateOrderCalculations);

  // Plus Minus Increments Binders
  setupPlusMinusListeners();

  // Price calculations and temporary chart price lines on inputs
  const tpInput = document.getElementById('tp-price-input');
  const slInput = document.getElementById('sl-price-input');

  tpInput.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    updateTempTpLine(val && val > 0 ? val : null);
    updateOrderCalculations();
  });

  slInput.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    updateTempSlLine(val && val > 0 ? val : null);
    updateOrderCalculations();
  });

  // Chart Picker Buttons
  const tpPicker = document.getElementById('tp-chart-picker');
  const slPicker = document.getElementById('sl-chart-picker');

  tpPicker.addEventListener('click', (e) => {
    e.stopPropagation();
    isPickingTp = !isPickingTp;
    isPickingSl = false; // reset SL
    slPicker.classList.remove('picking');
    
    if (isPickingTp) {
      tpPicker.classList.add('picking');
      showToast('info', 'TP Level Selection', 'Click on the chart to set your Take Profit price.');
      document.getElementById('chart-container').style.cursor = 'crosshair';
    } else {
      tpPicker.classList.remove('picking');
      document.getElementById('chart-container').style.cursor = 'default';
    }
  });

  slPicker.addEventListener('click', (e) => {
    e.stopPropagation();
    isPickingSl = !isPickingSl;
    isPickingTp = false; // reset TP
    tpPicker.classList.remove('picking');
    
    if (isPickingSl) {
      slPicker.classList.add('picking');
      showToast('info', 'SL Level Selection', 'Click on the chart to set your Stop Loss price.');
      document.getElementById('chart-container').style.cursor = 'crosshair';
    } else {
      slPicker.classList.remove('picking');
      document.getElementById('chart-container').style.cursor = 'default';
    }
  });

  // Order Submission
  executeBtn.addEventListener('click', handleExecuteOrder);
  document.getElementById('cancel-btn').addEventListener('click', () => {
    isBuyActive = null;
    sellTriggerBox.classList.remove('active');
    buyTriggerBox.classList.remove('active');
    executeUpdateButtonUI();
    showToast('info', 'Order Cancelled', 'Trade submission aborted.');
  });
}

function setupPlusMinusListeners() {
  const volInput = document.getElementById('order-volume-input');
  const pendingInput = document.getElementById('pending-price-input');
  const tpInput = document.getElementById('tp-price-input');
  const slInput = document.getElementById('sl-price-input');

  // Volume
  document.getElementById('volume-plus').addEventListener('click', () => {
    lotSizeValue = Math.min(100, lotSizeValue + 0.05);
    volInput.value = lotSizeValue.toFixed(2);
    executeUpdateButtonUI();
    updateOrderCalculations();
  });
  document.getElementById('volume-minus').addEventListener('click', () => {
    lotSizeValue = Math.max(0.01, lotSizeValue - 0.05);
    volInput.value = lotSizeValue.toFixed(2);
    executeUpdateButtonUI();
    updateOrderCalculations();
  });
  volInput.addEventListener('change', () => {
    lotSizeValue = Math.max(0.01, parseFloat(volInput.value) || 0.01);
    volInput.value = lotSizeValue.toFixed(2);
    executeUpdateButtonUI();
    updateOrderCalculations();
  });

  // Helper increment price function
  const incPrice = (inputField, scale) => {
    const val = parseFloat(inputField.value) || marketEngine.coins[getMappedSymbol()].currentPrice;
    const step = scale * 0.5;
    const newVal = parseFloat((val + step).toFixed(marketEngine.coins[getMappedSymbol()].decimalPlaces));
    inputField.value = newVal;

    if (inputField === tpInput) updateTempTpLine(newVal);
    if (inputField === slInput) updateTempSlLine(newVal);

    updateOrderCalculations();
  };
  const decPrice = (inputField, scale) => {
    const val = parseFloat(inputField.value) || marketEngine.coins[getMappedSymbol()].currentPrice;
    const step = scale * 0.5;
    const newVal = parseFloat(Math.max(0.00001, val - step).toFixed(marketEngine.coins[getMappedSymbol()].decimalPlaces));
    inputField.value = newVal;

    if (inputField === tpInput) updateTempTpLine(newVal);
    if (inputField === slInput) updateTempSlLine(newVal);

    updateOrderCalculations();
  };

  const getTickScale = () => {
    const coin = marketEngine.coins[getMappedSymbol()];
    return coin.currentPrice * 0.0002;
  };

  // Pending limit Price
  document.getElementById('pending-price-plus').addEventListener('click', () => incPrice(pendingInput, getTickScale()));
  document.getElementById('pending-price-minus').addEventListener('click', () => decPrice(pendingInput, getTickScale()));

  // TP/SL Price
  document.getElementById('tp-plus').addEventListener('click', () => incPrice(tpInput, getTickScale()));
  document.getElementById('tp-minus').addEventListener('click', () => decPrice(tpInput, getTickScale()));
  document.getElementById('sl-plus').addEventListener('click', () => incPrice(slInput, getTickScale()));
  document.getElementById('sl-minus').addEventListener('click', () => decPrice(slInput, getTickScale()));
}

function executeUpdateButtonUI() {
  const btn = document.getElementById('execute-btn');
  const container = document.getElementById('execution-actions-container');
  const statsSummary = document.getElementById('terminal-stats-summary');
  
  const tickerContainer = document.querySelector('.buy-sell-tickers-container');
  if (tickerContainer) {
    if (isBuyActive !== null) {
      tickerContainer.classList.add('has-active');
    } else {
      tickerContainer.classList.remove('has-active');
    }
  }

  if (isBuyActive === null) {
    if (container) container.classList.add('hidden');
    if (statsSummary) statsSummary.classList.add('hidden');
    return;
  }
  
  if (container) container.classList.remove('hidden');
  if (statsSummary) statsSummary.classList.remove('hidden');
  
  const action = isBuyActive ? 'Buy' : 'Sell';
  btn.textContent = `Confirm ${action} ${lotSizeValue.toFixed(2)} lots`;
  
  if (isBuyActive) {
    btn.className = 'bitstar-confirm-btn buy';
  } else {
    btn.className = 'bitstar-confirm-btn sell';
  }
}

function updateOrderCalculations() {
  if (!activeSymbol) return;
  const keySymbol = getMappedSymbol();
  const coin = marketEngine.coins[keySymbol];
  if (!coin) return;

  const price = currentOrderType === 'LIMIT' ? 
    parseFloat(document.getElementById('pending-price-input').value) || coin.currentPrice : 
    coin.currentPrice;

  // Bitstar standard lot volume calculations
  const lotMultiplier = getLotMultiplier();
  const cryptoVolume = lotSizeValue * lotMultiplier;
  const contractValue = cryptoVolume * price;
  
  // Bitstar standard default leverage: 1:400
  const leverageVal = 400;
  const marginRequired = contractValue / leverageVal;
  
  // Exness standard account spread cost representation
  const spreadDiff = getSpread(activeSymbol, coin.currentPrice);
  const fee = spreadDiff * (lotSizeValue * getLotMultiplier());

  document.getElementById('summary-fees').textContent = `≈ ${fee.toFixed(2)} USD`;
  document.getElementById('summary-margin').textContent = `${marginRequired.toFixed(2)} USD`;
  document.getElementById('summary-leverage').textContent = '1:400';

  // Dynamic TP/SL metrics below inputs
  const tpVal = parseFloat(document.getElementById('tp-price-input').value);
  const slVal = parseFloat(document.getElementById('sl-price-input').value);
  const equity = tradingEngine.equity || 10801.67; // baseline equity for percentage
  const decimals = coin.decimalPlaces;

  // Update TP Metrics
  const tpMetrics = document.getElementById('tp-metrics-display');
  if (tpVal && tpVal > 0) {
    const diff = tpVal - price;
    const usd = isBuyActive ? diff * cryptoVolume : -diff * cryptoVolume;
    const pips = (isBuyActive ? diff : -diff) / getPipSize(activeSymbol);
    const pct = (usd / equity) * 100;
    
    tpMetrics.classList.remove('hidden');
    tpMetrics.textContent = `${usd >= 0 ? '+' : ''}${pips.toLocaleString('en-US', {minimumFractionDigits: 1, maximumFractionDigits: 1})} pips | ${usd >= 0 ? '+' : ''}${usd.toFixed(2)} USD | ${usd >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
    tpMetrics.className = `tp-sl-metrics ${usd >= 0 ? 'profit' : 'loss'}`;
  } else {
    tpMetrics.classList.add('hidden');
  }

  // Update SL Metrics
  const slMetrics = document.getElementById('sl-metrics-display');
  if (slVal && slVal > 0) {
    const diff = slVal - price;
    const usd = isBuyActive ? diff * cryptoVolume : -diff * cryptoVolume;
    const pips = (isBuyActive ? diff : -diff) / getPipSize(activeSymbol);
    const pct = (usd / equity) * 100;
    
    slMetrics.classList.remove('hidden');
    slMetrics.textContent = `${usd >= 0 ? '+' : ''}${pips.toLocaleString('en-US', {minimumFractionDigits: 1, maximumFractionDigits: 1})} pips | ${usd >= 0 ? '+' : ''}${usd.toFixed(2)} USD | ${usd >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
    slMetrics.className = `tp-sl-metrics ${usd >= 0 ? 'profit' : 'loss'}`;
  } else {
    slMetrics.classList.add('hidden');
  }
}

function handleExecuteOrder() {
  const keySymbol = getMappedSymbol();
  const coin = marketEngine.coins[keySymbol];
  if (!coin) return;

  const spreadDiff = getSpread(keySymbol, coin.currentPrice);
  const sellPrice = coin.currentPrice - (spreadDiff / 2);
  const buyPrice = coin.currentPrice + (spreadDiff / 2);

  const price = currentOrderType === 'LIMIT' ? 
    parseFloat(document.getElementById('pending-price-input').value) || 0 : 
    (isBuyActive ? buyPrice : sellPrice);

  if (currentOrderType === 'LIMIT' && price <= 0) {
    showToast('error', 'Invalid Price', 'Please enter a limit price target.');
    return;
  }

  // Map lots to volume
  const lotMultiplier = getLotMultiplier();
  const cryptoVolume = lotSizeValue * lotMultiplier;

  // Bracket triggers (directly from input fields)
  let tpPrice = null;
  let slPrice = null;

  const tpVal = parseFloat(document.getElementById('tp-price-input').value);
  if (tpVal && tpVal > 0) {
    tpPrice = tpVal;
  }
  const slVal = parseFloat(document.getElementById('sl-price-input').value);
  if (slVal && slVal > 0) {
    slPrice = slVal;
  }

  // Leverage factor
  const leverageVal = 400;

  // Place order
  const success = tradingEngine.placeOrder({
    symbol: keySymbol,
    type: isBuyActive ? 'BUY' : 'SELL',
    orderType: currentOrderType,
    targetPrice: price,
    volume: cryptoVolume,
    leverage: leverageVal,
    tp: tpPrice,
    sl: slPrice
  });

  if (success) {
    document.getElementById('tp-price-input').value = '';
    document.getElementById('sl-price-input').value = '';
    clearTempPriceLines();
    
    // Reset form to neutral state
    isBuyActive = null;
    document.getElementById('action-sell-trigger').classList.remove('active');
    document.getElementById('action-buy-trigger').classList.remove('active');
    executeUpdateButtonUI();
  }
}

// ----------------------------------------------------
// Ticker Subscriptions
// ----------------------------------------------------
function handleMarketTick(coins) {
  // Update instruments sidebar panel prices
  updateInstrumentsPrices(coins);

  if (!activeSymbol) return;

  const keySymbol = getMappedSymbol();
  const activeCoin = coins[keySymbol];
  if (!activeCoin) return;

  const currentVersion = activeCoin.historyVersion || 0;
  if (lastSeenHistoryVersion[keySymbol] !== currentVersion) {
    lastSeenHistoryVersion[keySymbol] = currentVersion;
    reloadChartData();
    return;
  }

  const currentPrice = activeCoin.currentPrice;
  const dec = activeCoin.decimalPlaces;

  // Update header symbol ticker metrics text inside chart options
  const lastHistory = activeCoin.history[activeTimeframe];
  const lastClose = lastHistory && lastHistory.length > 1 ? lastHistory[lastHistory.length - 2].close : currentPrice;
  const change = currentPrice - lastClose;
  const changePct = (change / lastClose) * 100;
  const isUp = change >= 0;

  // Update title dynamically to match active symbol name and timeframe
  const tfVal = activeTimeframe >= 60 ? (activeTimeframe === 1440 ? 'D' : '1H') : activeTimeframe;
  document.getElementById('chart-info-symbol').innerHTML = `<span style="font-weight: 700; color: #fff;">${activeSymbol}</span> <span style="color: var(--text-secondary); margin-left: 4px; font-weight: 700;">${tfVal}</span>`;
  
  const dotColor = isUp ? '#00c076' : '#ff4d4d';
  const metricsHtml = `<span style="color: ${dotColor}; margin-right: 4px; vertical-align: middle; font-size: 8px;">●</span>` +
    `O${(lastHistory && lastHistory.length > 0 ? lastHistory[lastHistory.length - 1].open : currentPrice).toFixed(dec)} ` +
    `H${activeCoin.high24h.toFixed(dec)} ` +
    `L${activeCoin.low24h.toFixed(dec)} ` +
    `C${currentPrice.toFixed(dec)} ` +
    `<span style="color: ${isUp ? '#00c076' : '#ff4d4d'};">${isUp ? '+' : ''}${change.toFixed(dec)} (${isUp ? '+' : ''}${changePct.toFixed(2)}%)</span>`;
  document.getElementById('chart-info-metrics').innerHTML = metricsHtml;

  // Update split tickers prices
  // Sell display is slightly below bid; Buy display is slightly above ask
  const spreadDiff = getSpread(activeSymbol, currentPrice);
  const sellPrice = currentPrice - (spreadDiff / 2);
  const buyPrice = currentPrice + (spreadDiff / 2);

  // Format with superscript digit on the 4th decimal place (fractional pips display)
  const formatTickerText = (priceVal) => {
    const formatted = priceVal.toFixed(5);
    const dotIdx = formatted.indexOf('.');
    if (dotIdx !== -1) {
      const basePricePart = formatted.substring(0, dotIdx + 3);
      const largePart = formatted.substring(dotIdx + 3, dotIdx + 4);
      const superDigitPart = formatted.substring(dotIdx + 4, dotIdx + 5);
      return `<span style="opacity: 0.65;">${basePricePart}</span><span style="font-size: 19px; font-weight: 800; line-height: 1; vertical-align: middle;">${largePart}</span><sup style="font-size: 10px; vertical-align: super; margin-left: 1px; font-weight: 700;">${superDigitPart}</sup>`;
    }
    return priceVal.toFixed(4);
  };

  const sellEl = document.getElementById('sell-price-display');
  const buyEl = document.getElementById('buy-price-display');
  if (sellEl) sellEl.innerHTML = formatTickerText(sellPrice);
  if (buyEl) buyEl.innerHTML = formatTickerText(buyPrice);
  
  // Spread text (converted via asset-specific pip size)
  const pipsVal = spreadDiff / getPipSize(activeSymbol);
  const spreadEl = document.getElementById('spread-diff-val');
  if (spreadEl) spreadEl.innerHTML = `${pipsVal.toFixed(1)} pips <span style="font-size: 8px; margin-left: 2px; color: var(--text-secondary);">▾</span>`;

  // Update Chart real-time ticking
  if (candlestickSeries && volumeSeries) {
    const history = activeCoin.history[activeTimeframe];
    if (history && history.length > 0) {
      const last = history[history.length - 1];
      candlestickSeries.update({
        time: last.time,
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close
      });
      volumeSeries.update({
        time: last.time,
        value: last.volume,
        color: last.close >= last.open ? 'rgba(16, 128, 255, 0.12)' : 'rgba(226, 82, 65, 0.12)'
      });
    }
  }

  // Feed price updates to portfolio calculations
  tradingEngine.updateMarketPrices(coins);
}

function handleTradingTick(engine) {
  const lotMultiplier = getLotMultiplier();
  
  // Format standard prices helper without commas
  const fmt = (num) => num.toFixed(2);

  // Update header and bottom portfolio stat bar fields
  const displayEquity = `${fmt(engine.equity)} USD`;
  const displayFreeMargin = `${fmt(engine.freeMargin)} USD`;
  const displayBalance = `${fmt(engine.balance)} USD`;
  const displayMargin = `${fmt(engine.marginUsed)} USD`;

  document.getElementById('balance-header-display').textContent = displayBalance;
  document.getElementById('equity-display-val').textContent = displayEquity;
  document.getElementById('free-margin-display-val').textContent = displayFreeMargin;
  document.getElementById('balance-display-val').textContent = displayBalance;
  document.getElementById('margin-display-val').textContent = displayMargin;
  
  const lvlDisplay = document.getElementById('margin-level-display-val');
  if (engine.marginLevel === null) {
    lvlDisplay.textContent = '0.00%';
  } else {
    lvlDisplay.textContent = `${engine.marginLevel.toFixed(2)}%`;
  }

  // Update badges
  const posBadge = document.getElementById('badge-positions');
  if (posBadge) {
    if (engine.positions.length > 0) {
      posBadge.textContent = engine.positions.length;
      posBadge.style.display = 'inline-block';
    } else {
      posBadge.style.display = 'none';
    }
  }

  const pendingBadge = document.getElementById('badge-pending');
  if (pendingBadge) {
    if (engine.pendingOrders.length > 0) {
      pendingBadge.textContent = engine.pendingOrders.length;
      pendingBadge.style.display = 'inline-block';
    } else {
      pendingBadge.style.display = 'none';
    }
  }

  // Calculate and update Total P/L in the bottom bar
  let totalPnl = 0;
  engine.positions.forEach(pos => {
    totalPnl += pos.pnl;
  });
  const totalPnlDisplay = document.getElementById('total-pnl-display-val');
  if (totalPnlDisplay) {
    const isProfitable = totalPnl >= 0;
    totalPnlDisplay.textContent = `${isProfitable ? '+' : ''}${totalPnl.toFixed(2)}`;
    totalPnlDisplay.className = `val font-mono ${isProfitable ? 'font-up' : 'font-down'}`;
  }

  // Render open positions table
  renderPositionsTable(engine.positions, lotMultiplier);

  // Render pending limit orders table
  renderPendingOrdersTable(engine.pendingOrders, lotMultiplier);

  // Render closed history table
  renderHistoryTable(engine.history, lotMultiplier);
  
  // Update chart price lines for open positions and pending orders
  updateChartPriceLines(engine.positions, engine.pendingOrders);
  
  // Update calculations
  updateOrderCalculations();
}

// ----------------------------------------------------
// Secure DOM Table Builders (No innerHTML)
// ----------------------------------------------------
function getMarketCloseTimeStr(symbol) {
  if (symbol.startsWith('BTC')) return '24/7';
  
  const now = new Date();
  const utcDay = now.getUTCDay();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  
  let daysLeft = 5 - utcDay;
  if (daysLeft < 0 || (daysLeft === 0 && utcHours >= 21)) {
    daysLeft += 7;
  }
  
  let totalHours = daysLeft * 24 + (21 - utcHours);
  if (totalHours < 0) {
    totalHours += 168;
  }
  
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = (60 - utcMinutes) % 60;
  
  return `${days}d ${hours}h ${minutes}m`;
}

function formatBitstarDateTime(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  const dayName = days[date.getDay()];
  const dayVal = date.getDate();
  const monthName = months[date.getMonth()];
  const yearShort = date.getFullYear().toString().substr(-2);
  
  const hrs = date.getHours().toString().padStart(2, '0');
  const mins = date.getMinutes().toString().padStart(2, '0');
  
  return `${dayName} ${dayVal} ${monthName} '${yearShort} ${hrs}:${mins}`;
}

function renderPositionsTable(positions, lotMultiplier) {
  const tbody = document.getElementById('positions-table-body');
  if (!tbody) return;

  if (positions.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.setAttribute('colspan', '13');
    td.className = 'empty-table';
    td.textContent = 'No open positions. Use the right panel to execute a trade.';
    tr.appendChild(td);
    tbody.replaceChildren(tr);
    return;
  }

  const rows = positions.map(pos => {
    const tr = document.createElement('tr');

    const tdAsset = document.createElement('td');
    tdAsset.className = 'font-mono';
    tdAsset.textContent = `${pos.symbol.replace('/', '')}`;

    const tdType = document.createElement('td');
    const typeSpan = document.createElement('span');
    typeSpan.className = pos.type === 'BUY' ? 'font-up' : 'font-down';
    typeSpan.textContent = pos.type === 'BUY' ? 'Buy' : 'Sell';
    tdType.appendChild(typeSpan);

    const tdVolume = document.createElement('td');
    tdVolume.className = 'font-mono';
    const lots = pos.volume / lotMultiplier;
    tdVolume.textContent = lots.toFixed(2);

    // Dynamic decimals depending on asset
    const keySymbol = pos.symbol;
    const coin = marketEngine.coins[keySymbol];
    const dec = coin ? coin.decimalPlaces : 2;

    const tdEntry = document.createElement('td');
    tdEntry.className = 'font-mono';
    tdEntry.textContent = `${pos.entryPrice.toFixed(dec)}`;

    const tdCurrent = document.createElement('td');
    tdCurrent.className = 'font-mono';
    tdCurrent.textContent = `${pos.currentPrice.toFixed(dec)}`;

    const tdTp = document.createElement('td');
    tdTp.className = 'font-mono';
    tdTp.textContent = pos.tp ? pos.tp.toFixed(dec) : '-';

    const tdSl = document.createElement('td');
    tdSl.className = 'font-mono';
    tdSl.textContent = pos.sl ? pos.sl.toFixed(dec) : '-';

    const tdPosition = document.createElement('td');
    tdPosition.className = 'font-mono';
    tdPosition.textContent = pos.id ? `#${pos.id.replace('ord_', '')}` : '-';

    const tdOpenTime = document.createElement('td');
    tdOpenTime.className = 'font-mono';
    tdOpenTime.textContent = formatBitstarDateTime(pos.timestamp);

    const tdSwap = document.createElement('td');
    tdSwap.className = 'font-mono';
    tdSwap.textContent = `$${(pos.swap || 0).toFixed(2)}`;

    const tdCloses = document.createElement('td');
    tdCloses.className = 'font-mono';
    tdCloses.textContent = getMarketCloseTimeStr(pos.symbol);

    const tdPnl = document.createElement('td');
    const pnlSpan = document.createElement('span');
    const isProfitable = pos.pnl >= 0;
    pnlSpan.className = `font-mono ${isProfitable ? 'font-up' : 'font-down'}`;
    pnlSpan.textContent = `${isProfitable ? '+' : ''}$${pos.pnl.toFixed(2)}`;
    tdPnl.appendChild(pnlSpan);

    const tdAction = document.createElement('td');
    tdAction.className = 'align-right';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'action-btn-close';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => {
      tradingEngine.closePosition(pos.id);
    });
    tdAction.appendChild(closeBtn);

    tr.appendChild(tdAsset);
    tr.appendChild(tdType);
    tr.appendChild(tdVolume);
    tr.appendChild(tdEntry);
    tr.appendChild(tdCurrent);
    tr.appendChild(tdTp);
    tr.appendChild(tdSl);
    tr.appendChild(tdPosition);
    tr.appendChild(tdOpenTime);
    tr.appendChild(tdSwap);
    tr.appendChild(tdCloses);
    tr.appendChild(tdPnl);
    tr.appendChild(tdAction);

    return tr;
  });

  tbody.replaceChildren(...rows);
}

function renderPendingOrdersTable(orders, lotMultiplier) {
  const tbody = document.getElementById('pending-table-body');
  if (!tbody) return;

  if (orders.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.setAttribute('colspan', '6');
    td.className = 'empty-table';
    td.textContent = 'No pending orders.';
    tr.appendChild(td);
    tbody.replaceChildren(tr);
    return;
  }

  const rows = orders.map(order => {
    const tr = document.createElement('tr');

    const tdAsset = document.createElement('td');
    tdAsset.className = 'font-mono';
    tdAsset.textContent = `${order.symbol.replace('/', '')}`;

    const tdType = document.createElement('td');
    const typeSpan = document.createElement('span');
    typeSpan.className = order.type === 'BUY' ? 'font-up' : 'font-down';
    typeSpan.textContent = `${order.type === 'BUY' ? 'Buy' : 'Sell'} Limit`;
    tdType.appendChild(typeSpan);

    // Dynamic decimals depending on asset
    const keySymbol = order.symbol;
    const coin = marketEngine.coins[keySymbol];
    const dec = coin ? coin.decimalPlaces : 2;

    const tdTarget = document.createElement('td');
    tdTarget.className = 'font-mono';
    tdTarget.textContent = `${order.targetPrice.toFixed(dec)}`;

    const tdVolume = document.createElement('td');
    tdVolume.className = 'font-mono';
    const lots = order.volume / lotMultiplier;
    tdVolume.textContent = lots.toFixed(2);

    const estMargin = (order.volume * order.targetPrice) / order.leverage;
    const tdMargin = document.createElement('td');
    tdMargin.className = 'font-mono';
    tdMargin.textContent = `$${estMargin.toFixed(2)}`;

    const tdAction = document.createElement('td');
    tdAction.className = 'align-right';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'action-btn-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      tradingEngine.cancelPendingOrder(order.id);
    });
    tdAction.appendChild(cancelBtn);

    tr.appendChild(tdAsset);
    tr.appendChild(tdType);
    tr.appendChild(tdTarget);
    tr.appendChild(tdVolume);
    tr.appendChild(tdMargin);
    tr.appendChild(tdAction);

    return tr;
  });

  tbody.replaceChildren(...rows);
}

function renderHistoryTable(history, lotMultiplier) {
  const tbody = document.getElementById('history-table-body');
  if (!tbody) return;

  if (history.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.setAttribute('colspan', '13');
    td.className = 'empty-table';
    td.textContent = 'No closed trades in this session.';
    tr.appendChild(td);
    tbody.replaceChildren(tr);
    return;
  }

  const rows = history.map(item => {
    const tr = document.createElement('tr');

    const tdAsset = document.createElement('td');
    tdAsset.className = 'font-mono';
    tdAsset.textContent = `${item.symbol.replace('/', '')}`;

    const tdType = document.createElement('td');
    const typeSpan = document.createElement('span');
    typeSpan.className = item.type === 'BUY' ? 'font-up' : 'font-down';
    typeSpan.textContent = item.type === 'BUY' ? 'Buy' : 'Sell';
    tdType.appendChild(typeSpan);

    const tdVolume = document.createElement('td');
    tdVolume.className = 'font-mono';
    const lots = item.volume / lotMultiplier;
    tdVolume.textContent = lots.toFixed(2);

    // Dynamic decimals depending on asset
    const keySymbol = item.symbol;
    const coin = marketEngine.coins[keySymbol];
    const dec = coin ? coin.decimalPlaces : 2;

    const tdEntry = document.createElement('td');
    tdEntry.className = 'font-mono';
    tdEntry.textContent = `${item.entryPrice.toFixed(dec)}`;

    const tdExit = document.createElement('td');
    tdExit.className = 'font-mono';
    tdExit.textContent = `${item.exitPrice.toFixed(dec)}`;

    const tdTp = document.createElement('td');
    tdTp.className = 'font-mono';
    tdTp.textContent = item.tp ? item.tp.toFixed(dec) : '-';

    const tdSl = document.createElement('td');
    tdSl.className = 'font-mono';
    tdSl.textContent = item.sl ? item.sl.toFixed(dec) : '-';

    const tdPosition = document.createElement('td');
    tdPosition.className = 'font-mono';
    tdPosition.textContent = item.id ? `#${item.id.replace('ord_', '')}` : '-';

    const tdOpenTime = document.createElement('td');
    tdOpenTime.className = 'font-mono';
    tdOpenTime.textContent = formatBitstarDateTime(item.openTime);

    const tdCloseTime = document.createElement('td');
    tdCloseTime.className = 'font-mono';
    tdCloseTime.textContent = formatBitstarDateTime(item.closeTime);

    const tdSwap = document.createElement('td');
    tdSwap.className = 'font-mono';
    tdSwap.textContent = `$${(item.swap || 0).toFixed(2)}`;

    const tdReason = document.createElement('td');
    tdReason.textContent = item.exitReason;
    if (item.exitReason === 'Liquidation (Stop Out)') {
      tdReason.className = 'font-down';
    } else if (item.exitReason === 'Take Profit') {
      tdReason.className = 'font-up';
    }

    const tdPnl = document.createElement('td');
    const pnlSpan = document.createElement('span');
    const isProfitable = item.pnl >= 0;
    pnlSpan.className = `font-mono ${isProfitable ? 'font-up' : 'font-down'}`;
    pnlSpan.textContent = `${isProfitable ? '+' : ''}$${item.pnl.toFixed(2)}`;
    tdPnl.appendChild(pnlSpan);
    tdPnl.className = 'align-right';

    tr.appendChild(tdAsset);
    tr.appendChild(tdType);
    tr.appendChild(tdVolume);
    tr.appendChild(tdEntry);
    tr.appendChild(tdExit);
    tr.appendChild(tdTp);
    tr.appendChild(tdSl);
    tr.appendChild(tdPosition);
    tr.appendChild(tdOpenTime);
    tr.appendChild(tdCloseTime);
    tr.appendChild(tdSwap);
    tr.appendChild(tdReason);
    tr.appendChild(tdPnl);

    return tr;
  });

  tbody.replaceChildren(...rows);
}

// ----------------------------------------------------
// Chart Horizontal Price Lines (TP/SL & Orders)
// ----------------------------------------------------
function updateChartPriceLines(positions, pendingOrders) {
  if (!candlestickSeries) return;

  // Clear previous lines
  activeChartPriceLines.forEach(line => {
    try {
      candlestickSeries.removePriceLine(line);
    } catch (e) {
      console.warn("Failed to remove old price line", e);
    }
  });
  activeChartPriceLines = [];

  const currentMapped = getMappedSymbol();

  const lotMultiplier = getLotMultiplier();

  // Draw open positions entry, TP, and SL lines
  positions.forEach(pos => {
    if (pos.symbol !== currentMapped) return;

    const lots = pos.volume / lotMultiplier;
    const lotStr = Number.isInteger(lots) ? lots.toString() : lots.toFixed(2);
    const tpText = pos.tp ? 'TP  ' : '';
    const slText = pos.sl ? 'SL  ' : '';
    const pnlText = `${pos.pnl >= 0 ? '+' : ''}${pos.pnl.toFixed(2)} USD`;
    const lineTitle = `${tpText}${slText}${lotStr}  ${pnlText}  ×`;

    // Entry line
    const entryLine = candlestickSeries.createPriceLine({
      price: pos.entryPrice,
      color: '#1080ff', // blue
      lineWidth: 1,
      lineStyle: 1, // dotted
      axisLabelVisible: true,
      title: lineTitle
    });
    activeChartPriceLines.push(entryLine);

    // TP line
    if (pos.tp) {
      const tpLine = candlestickSeries.createPriceLine({
        price: pos.tp,
        color: '#00c076', // green
        lineWidth: 1,
        lineStyle: 2, // dashed
        axisLabelVisible: true,
        title: `TP #${pos.id.substr(4, 4)}`
      });
      activeChartPriceLines.push(tpLine);
    }

    // SL line
    if (pos.sl) {
      const slLine = candlestickSeries.createPriceLine({
        price: pos.sl,
        color: '#e25241', // red
        lineWidth: 1,
        lineStyle: 2, // dashed
        axisLabelVisible: true,
        title: `SL #${pos.id.substr(4, 4)}`
      });
      activeChartPriceLines.push(slLine);
    }
  });

  // Draw pending limit orders lines
  pendingOrders.forEach(order => {
    if (order.symbol !== currentMapped) return;

    const limitLine = candlestickSeries.createPriceLine({
      price: order.targetPrice,
      color: '#ffb700', // gold
      lineWidth: 1,
      lineStyle: 2, // dashed
      axisLabelVisible: true,
      title: `Limit ${order.type} #${order.id.substr(4, 4)}`
    });
    activeChartPriceLines.push(limitLine);
  });
}

function updateTempTpLine(price) {
  if (!candlestickSeries) return;
  if (tempTpLine) {
    try {
      candlestickSeries.removePriceLine(tempTpLine);
    } catch (e) {}
    tempTpLine = null;
  }
  if (price) {
    tempTpLine = candlestickSeries.createPriceLine({
      price: price,
      color: 'rgba(0, 192, 118, 0.4)', // transparent green
      lineWidth: 1,
      lineStyle: 2, // dashed
      axisLabelVisible: true,
      title: 'Pending TP'
    });
  }
}

function updateTempSlLine(price) {
  if (!candlestickSeries) return;
  if (tempSlLine) {
    try {
      candlestickSeries.removePriceLine(tempSlLine);
    } catch (e) {}
    tempSlLine = null;
  }
  if (price) {
    tempSlLine = candlestickSeries.createPriceLine({
      price: price,
      color: 'rgba(226, 82, 65, 0.4)', // transparent red
      lineWidth: 1,
      lineStyle: 2, // dashed
      axisLabelVisible: true,
      title: 'Pending SL'
    });
  }
}

function clearTempPriceLines() {
  if (!candlestickSeries) return;
  if (tempTpLine) {
    try {
      candlestickSeries.removePriceLine(tempTpLine);
    } catch (e) {}
    tempTpLine = null;
  }
  if (tempSlLine) {
    try {
      candlestickSeries.removePriceLine(tempSlLine);
    } catch (e) {}
    tempSlLine = null;
  }
}

// ----------------------------------------------------
// Technical Indicators Calculation Algorithms
// ----------------------------------------------------
function calculateEMA(data, period) {
  const ema = [];
  if (data.length === 0) return ema;

  const multiplier = 2 / (period + 1);
  
  let sum = 0;
  const initRange = Math.min(period, data.length);
  for (let i = 0; i < initRange; i++) {
    sum += data[i].close;
  }
  let prevEma = sum / initRange;
  
  ema.push({ time: data[initRange - 1].time, value: prevEma });

  for (let i = initRange; i < data.length; i++) {
    const currentEma = (data[i].close - prevEma) * multiplier + prevEma;
    ema.push({ time: data[i].time, value: currentEma });
    prevEma = currentEma;
  }
  return ema;
}

function calculateBollingerBands(data, period = 20) {
  const upper = [];
  const basis = [];
  const lower = [];

  if (data.length < period) return { upper, basis, lower };

  for (let i = period - 1; i < data.length; i++) {
    const subset = data.slice(i - period + 1, i + 1);
    const prices = subset.map(d => d.close);
    
    const sum = prices.reduce((a, b) => a + b, 0);
    const mean = sum / period;
    
    const variance = prices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    
    const time = data[i].time;
    basis.push({ time, value: mean });
    upper.push({ time, value: mean + 2 * stdDev });
    lower.push({ time, value: mean - 2 * stdDev });
  }

  return { upper, basis, lower };
}

// ----------------------------------------------------
// Chart Series Visibility & Type Helper
// ----------------------------------------------------
function getActiveSeries() {
  if (currentChartType === 'line') return areaSeries;
  if (currentChartType === 'bars') return barSeries;
  return candlestickSeries;
}

// ----------------------------------------------------
// Synchronized Overlay Drawing Canvas Engine
// ----------------------------------------------------
function drawCanvas() {
  const canvas = document.getElementById('chart-drawing-canvas');
  if (!canvas || !chart) return;
  
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (isDrawingsHidden) return; // Skip drawing

  const activeSeries = getActiveSeries();
  if (!activeSeries) return;

  const timeScale = chart.timeScale();

  // Draw completed drawings
  drawings.forEach(drawing => {
    const x1 = timeScale.timeToCoordinate(drawing.start.time);
    const y1 = activeSeries.priceToCoordinate(drawing.start.price);
    
    // One-click annotations might not have end coordinates
    const x2 = drawing.end ? timeScale.timeToCoordinate(drawing.end.time) : null;
    const y2 = drawing.end ? activeSeries.priceToCoordinate(drawing.end.price) : null;

    const keySymbol = getMappedSymbol();
    const coin = marketEngine.coins[keySymbol];
    const dec = coin ? coin.decimalPlaces : 2;

    if (x1 !== null && y1 !== null) {
      if (drawing.type === 'text') {
        ctx.fillStyle = '#ffffff';
        ctx.font = '500 11px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        
        // Measure text for background panel
        const textWidth = ctx.measureText(drawing.text).width;
        ctx.fillStyle = 'rgba(12, 13, 18, 0.85)';
        ctx.fillRect(x1 - 4, y1 - 15, textWidth + 8, 18);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x1 - 4, y1 - 15, textWidth + 8, 18);

        ctx.fillStyle = '#ffffff';
        ctx.fillText(drawing.text, x1, y1 - 2);
      } else if (drawing.type === 'emoji') {
        ctx.font = '18px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(drawing.emoji || '🚀', x1, y1);
      } else if (x2 !== null && y2 !== null) {
        if (drawing.type === 'trendline') {
          // Draw trend line
          ctx.strokeStyle = '#ffb700'; // Bitstar Gold
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();

          // Control nodes
          ctx.fillStyle = '#ffb700';
          ctx.beginPath();
          ctx.arc(x1, y1, 3.5, 0, 2 * Math.PI);
          ctx.arc(x2, y2, 3.5, 0, 2 * Math.PI);
          ctx.fill();
        } else if (drawing.type === 'channel') {
          // Parallel Channel
          const offset = 20; // 20px Y-offset
          ctx.strokeStyle = '#b388ff'; // Lavender/Purple
          ctx.lineWidth = 1.5;
          
          // Boundary 1
          ctx.beginPath();
          ctx.moveTo(x1, y1 - offset);
          ctx.lineTo(x2, y2 - offset);
          ctx.stroke();
          
          // Boundary 2
          ctx.beginPath();
          ctx.moveTo(x1, y1 + offset);
          ctx.lineTo(x2, y2 + offset);
          ctx.stroke();
          
          // Fill inside channel
          ctx.fillStyle = 'rgba(179, 136, 255, 0.05)';
          ctx.beginPath();
          ctx.moveTo(x1, y1 - offset);
          ctx.lineTo(x2, y2 - offset);
          ctx.lineTo(x2, y2 + offset);
          ctx.lineTo(x1, y1 + offset);
          ctx.closePath();
          ctx.fill();
          
          // Dashed Center line
          ctx.strokeStyle = 'rgba(179, 136, 255, 0.4)';
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.setLineDash([]);
        } else if (drawing.type === 'gannfan') {
          // Gann Fan radiating rays
          const dx = x2 - x1;
          const dy = y2 - y1;
          ctx.strokeStyle = '#bf5af2'; // Purple
          ctx.lineWidth = 1;
          
          const ratios = [
            { rx: 1, ry: 1 },
            { rx: 1, ry: 0.5 },
            { rx: 1, ry: 0.33 },
            { rx: 1, ry: 0.25 },
            { rx: 0.5, ry: 1 },
            { rx: 0.33, ry: 1 },
            { rx: 0.25, ry: 1 }
          ];
          
          ratios.forEach(r => {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x1 + dx * r.rx, y1 + dy * r.ry);
            ctx.stroke();
          });
        } else if (drawing.type === 'fib') {
          // Fibonacci Retracement
          const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
          const colors = [
            'rgba(255, 77, 77, 0.75)',    // 0%
            'rgba(255, 159, 10, 0.75)',   // 23.6%
            'rgba(255, 214, 10, 0.75)',   // 38.2%
            'rgba(0, 192, 118, 0.75)',    // 50%
            'rgba(10, 132, 255, 0.75)',   // 61.8%
            'rgba(191, 90, 242, 0.75)',   // 78.6%
            'rgba(255, 255, 255, 0.75)'   // 100%
          ];
          
          levels.forEach((lvl, idx) => {
            const price = drawing.start.price + (drawing.end.price - drawing.start.price) * lvl;
            const y = activeSeries.priceToCoordinate(price);
            if (y !== null) {
              ctx.strokeStyle = colors[idx];
              ctx.lineWidth = 1;
              ctx.setLineDash([3, 3]);
              ctx.beginPath();
              ctx.moveTo(x1, y);
              ctx.lineTo(x2, y);
              ctx.stroke();
              ctx.setLineDash([]);
              
              ctx.fillStyle = colors[idx];
              ctx.font = '9px Inter, sans-serif';
              ctx.fillText(`${(lvl * 100).toFixed(1)}% - ${price.toFixed(dec)}`, x1 + 4, y - 2);
            }
          });
        } else if (drawing.type === 'brush') {
          // Highlight Brush semi-transparent marker
          ctx.strokeStyle = 'rgba(255, 214, 10, 0.22)'; // Yellow high-light color
          ctx.lineWidth = 14;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        } else if (drawing.type === 'ruler') {
          // Ruler measuring bounding box
          ctx.fillStyle = 'rgba(16, 128, 255, 0.08)';
          ctx.strokeStyle = 'rgba(16, 128, 255, 0.4)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.rect(x1, y1, x2 - x1, y2 - y1);
          ctx.fill();
          ctx.stroke();

          // Calculations
          const priceDiff = drawing.end.price - drawing.start.price;
          const pctChange = (priceDiff / drawing.start.price) * 100;
          
          const history = marketEngine.getHistory(keySymbol, activeTimeframe);
          const startIndex = history.findIndex(c => c.time === drawing.start.time);
          const endIndex = history.findIndex(c => c.time === drawing.end.time);
          const barsCount = (startIndex !== -1 && endIndex !== -1) ? Math.abs(endIndex - startIndex) + 1 : 0;
          const sign = priceDiff >= 0 ? '+' : '';

          const text = `${sign}${priceDiff.toFixed(dec)} (${sign}${pctChange.toFixed(2)}%) | ${barsCount} Bars`;
          
          ctx.fillStyle = '#ffffff';
          ctx.font = '700 10px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(text, (x1 + x2) / 2, Math.min(y1, y2) - 8);
        }
      }
    }
  });

  // Draw active drawing preview line/box
  if (drawingStartPoint && currentHoverPoint) {
    const x1 = timeScale.timeToCoordinate(drawingStartPoint.time);
    const y1 = activeSeries.priceToCoordinate(drawingStartPoint.price);
    const x2 = currentHoverPoint.x;
    const y2 = activeSeries.priceToCoordinate(currentHoverPoint.price); // Snap vertically to price coordinate

    if (x1 !== null && y1 !== null && y2 !== null) {
      if (activeDrawingTool === 'trendline') {
        ctx.strokeStyle = 'rgba(255, 183, 0, 0.6)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (activeDrawingTool === 'channel') {
        const offset = 20;
        ctx.strokeStyle = 'rgba(179, 136, 255, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        
        ctx.beginPath();
        ctx.moveTo(x1, y1 - offset);
        ctx.lineTo(x2, y2 - offset);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(x1, y1 + offset);
        ctx.lineTo(x2, y2 + offset);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (activeDrawingTool === 'gannfan') {
        const dx = x2 - x1;
        const dy = y2 - y1;
        ctx.strokeStyle = 'rgba(191, 90, 242, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        
        const ratios = [
          { rx: 1, ry: 1 },
          { rx: 1, ry: 0.5 },
          { rx: 1, ry: 0.33 },
          { rx: 1, ry: 0.25 },
          { rx: 0.5, ry: 1 },
          { rx: 0.33, ry: 1 },
          { rx: 0.25, ry: 1 }
        ];
        
        ratios.forEach(r => {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 + dx * r.rx, y1 + dy * r.ry);
          ctx.stroke();
        });
        ctx.setLineDash([]);
      } else if (activeDrawingTool === 'fib') {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(x1, y2);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y1);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (activeDrawingTool === 'brush') {
        ctx.strokeStyle = 'rgba(255, 214, 10, 0.15)';
        ctx.lineWidth = 14;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      } else if (activeDrawingTool === 'ruler') {
        ctx.fillStyle = 'rgba(16, 128, 255, 0.05)';
        ctx.strokeStyle = 'rgba(16, 128, 255, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(x1, y1, x2 - x1, y2 - y1);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}

// ----------------------------------------------------
// UI Dropdown Bindings & Screen Capture Logic
// ----------------------------------------------------
function initChartUIPanels() {
  const indicatorsBtn = document.getElementById('indicators-btn');
  const indicatorsDropdown = document.getElementById('indicators-dropdown-menu');
  const chartTypeBtn = document.getElementById('chart-type-btn');
  const chartTypeDropdown = document.getElementById('chart-type-dropdown-menu');

  if (indicatorsBtn && indicatorsDropdown) {
    indicatorsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      indicatorsDropdown.classList.toggle('hidden');
      if (chartTypeDropdown) chartTypeDropdown.classList.add('hidden');
    });
  }

  if (chartTypeBtn && chartTypeDropdown) {
    chartTypeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      chartTypeDropdown.classList.toggle('hidden');
      if (indicatorsDropdown) indicatorsDropdown.classList.add('hidden');
    });
  }

  document.addEventListener('click', () => {
    if (indicatorsDropdown) indicatorsDropdown.classList.add('hidden');
    if (chartTypeDropdown) chartTypeDropdown.classList.add('hidden');
  });

  // Toggle Technical Indicators
  const indicatorOptions = document.querySelectorAll('.indicator-option');
  indicatorOptions.forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const indicator = opt.getAttribute('data-indicator');
      enabledIndicators[indicator] = !enabledIndicators[indicator];
      updateIndicatorsUI();
      reloadChartData();
    });
  });

  // Switch Series Types
  const typeOptions = document.querySelectorAll('.type-option');
  typeOptions.forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const type = opt.getAttribute('data-type');
      currentChartType = type;
      updateChartTypeUI();
      if (chartTypeDropdown) chartTypeDropdown.classList.add('hidden');
    });
  });

  // Draw Tools Sidebar Click Handlers
  const crosshairBtn = document.getElementById('draw-btn-crosshair');
  const trendlineBtn = document.getElementById('draw-btn-trendline');
  const channelBtn = document.getElementById('draw-btn-sliders'); // parallel channel
  const gannfanBtn = document.getElementById('draw-btn-graph'); // gann fan
  const fibBtn = document.getElementById('draw-btn-fib'); // fib retracement
  const brushBtn = document.getElementById('draw-btn-brush'); // brush
  const textBtn = document.getElementById('draw-btn-text'); // text
  const smileyBtn = document.getElementById('draw-btn-smiley'); // emoji sticker
  const rulerBtn = document.getElementById('draw-btn-ruler');
  const zoomBtn = document.getElementById('draw-btn-zoom');
  const trashBtn = document.getElementById('draw-btn-trash');
  
  // Toggles
  const magnetBtn = document.getElementById('draw-btn-magnet');
  const staydrawBtn = document.getElementById('draw-btn-staydraw');
  const lockallBtn = document.getElementById('draw-btn-lockall');
  const hideallBtn = document.getElementById('draw-btn-hideall');
  
  const drawCanvasEl = document.getElementById('chart-drawing-canvas');

  const setDrawingTool = (tool, activeBtn) => {
    if (isDrawingsLocked && tool) {
      showToast('error', 'Drawings Locked', 'All drawings are currently locked.');
      return;
    }
    
    activeDrawingTool = tool;
    drawingStartPoint = null;
    
    document.querySelectorAll('.drawing-btn').forEach(btn => btn.classList.remove('active'));
    if (activeBtn) activeBtn.classList.add('active');
    
    const chartContainer = document.getElementById('chart-container');
    if (chartContainer) {
      if (tool) {
        chartContainer.style.cursor = 'crosshair';
      } else {
        chartContainer.style.cursor = 'default';
      }
    }
    
    if (drawCanvasEl) {
      if (tool) {
        drawCanvasEl.classList.add('drawing-mode-active');
      } else {
        drawCanvasEl.classList.remove('drawing-mode-active');
      }
      drawCanvasEl.style.pointerEvents = 'none'; // Always let clicks pass through to chart
    }
  };

  if (crosshairBtn) {
    crosshairBtn.addEventListener('click', () => {
      setDrawingTool(null, crosshairBtn);
      showToast('info', 'Pointer Active', 'Crosshair standard mouse navigation active.');
    });
  }

  if (trendlineBtn) {
    trendlineBtn.addEventListener('click', () => {
      setDrawingTool('trendline', trendlineBtn);
      showToast('info', 'Trend Line Active', 'Click on the chart to select the start coordinate.');
    });
  }
  
  if (channelBtn) {
    channelBtn.addEventListener('click', () => {
      setDrawingTool('channel', channelBtn);
      showToast('info', 'Parallel Channel Active', 'Click on the chart to select the start coordinate.');
    });
  }
  
  if (gannfanBtn) {
    gannfanBtn.addEventListener('click', () => {
      setDrawingTool('gannfan', gannfanBtn);
      showToast('info', 'Gann Fan Active', 'Click on the chart to select the start coordinate.');
    });
  }
  
  if (fibBtn) {
    fibBtn.addEventListener('click', () => {
      setDrawingTool('fib', fibBtn);
      showToast('info', 'Fib Retracement Active', 'Click on the chart to select the start coordinate.');
    });
  }
  
  if (brushBtn) {
    brushBtn.addEventListener('click', () => {
      setDrawingTool('brush', brushBtn);
      showToast('info', 'Highlight Brush Active', 'Click on the chart to select the start coordinate.');
    });
  }
  
  if (textBtn) {
    textBtn.addEventListener('click', () => {
      setDrawingTool('text', textBtn);
      showToast('info', 'Text Annotation Active', 'Click on the chart to choose text placement coordinate.');
    });
  }
  
  if (smileyBtn) {
    smileyBtn.addEventListener('click', () => {
      setDrawingTool('emoji', smileyBtn);
      showToast('info', 'Emoji Sticker Active', 'Click on the chart to choose sticker placement coordinate.');
    });
  }

  if (rulerBtn) {
    rulerBtn.addEventListener('click', () => {
      setDrawingTool('ruler', rulerBtn);
      showToast('info', 'Ruler Measure Active', 'Click on the chart to select the start measurement coordinate.');
    });
  }
  
  if (zoomBtn) {
    zoomBtn.addEventListener('click', () => {
      setDrawingTool('zoom', zoomBtn);
      showToast('info', 'Zoom Active', 'Click on the chart to choose start coordinate of zoom area.');
    });
  }

  if (trashBtn) {
    trashBtn.addEventListener('click', () => {
      if (isDrawingsLocked) {
        showToast('error', 'Drawings Locked', 'All drawings are currently locked.');
        return;
      }
      drawings = [];
      drawingStartPoint = null;
      setDrawingTool(null, crosshairBtn);
      drawCanvas();
      showToast('info', 'Drawings Cleared', 'All lines and rulers successfully removed.');
    });
  }
  
  if (magnetBtn) {
    magnetBtn.addEventListener('click', () => {
      isMagnetMode = !isMagnetMode;
      magnetBtn.classList.toggle('active', isMagnetMode);
      showToast('info', 'Magnet Mode', `Magnet snapping is now ${isMagnetMode ? 'ON' : 'OFF'}.`);
    });
  }
  
  if (staydrawBtn) {
    staydrawBtn.addEventListener('click', () => {
      isStayInDrawingMode = !isStayInDrawingMode;
      staydrawBtn.classList.toggle('active', isStayInDrawingMode);
      showToast('info', 'Stay-in-Drawing Mode', `Stay-in-Drawing mode is now ${isStayInDrawingMode ? 'ON' : 'OFF'}.`);
    });
  }
  
  if (lockallBtn) {
    lockallBtn.addEventListener('click', () => {
      isDrawingsLocked = !isDrawingsLocked;
      lockallBtn.classList.toggle('active', isDrawingsLocked);
      showToast('info', 'Lock Drawings', `All drawings are now ${isDrawingsLocked ? 'LOCKED' : 'UNLOCKED'}.`);
    });
  }
  
  if (hideallBtn) {
    hideallBtn.addEventListener('click', () => {
      isDrawingsHidden = !isDrawingsHidden;
      hideallBtn.classList.toggle('active', isDrawingsHidden);
      drawCanvas();
      showToast('info', 'Hide Drawings', `Drawings are now ${isDrawingsHidden ? 'HIDDEN' : 'VISIBLE'}.`);
    });
  }

  // Fullscreen Mode
  const fullscreenBtn = document.querySelector('[title="Fullscreen Toggle"]');
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => {
      const wrapper = document.querySelector('.chart-wrapper');
      if (!wrapper) return;
      if (!document.fullscreenElement) {
        wrapper.requestFullscreen().catch(err => {
          showToast('error', 'Fullscreen Error', 'Could not open fullscreen chart.');
        });
      } else {
        document.exitFullscreen();
      }
    });
  }

  // Capture combined screenshot
  const screenshotBtn = document.querySelector('[title="Take Screenshot"]');
  if (screenshotBtn) {
    screenshotBtn.addEventListener('click', () => {
      if (!chart) return;
      const chartCanvas = chart.takeScreenshot();
      if (chartCanvas) {
        const combined = document.createElement('canvas');
        combined.width = chartCanvas.width;
        combined.height = chartCanvas.height;
        const ctx = combined.getContext('2d');
        ctx.drawImage(chartCanvas, 0, 0);

        const overlay = document.getElementById('chart-drawing-canvas');
        if (overlay) {
          ctx.drawImage(overlay, 0, 0, combined.width, combined.height);
        }

        const link = document.createElement('a');
        link.download = `bitstar-${activeSymbol}-${activeTimeframe}m-chart.png`;
        link.href = combined.toDataURL('image/png');
        link.click();
        showToast('success', 'Screenshot Downloaded', 'Premium chart screenshot downloaded.');
      } else {
        showToast('error', 'Screenshot Failed', 'Unable to capture chart canvas.');
      }
    });
  }

  // LocalStorage Save Layout
  const saveBtn = document.querySelector('[title="Save Layout"]');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const layout = {
        symbol: activeSymbol,
        timeframe: activeTimeframe,
        chartType: currentChartType,
        indicators: enabledIndicators,
        drawings: drawings,
        volumeVisible: isVolumeVisible
      };
      localStorage.setItem('bitstar_chart_layout', JSON.stringify(layout));
      showToast('success', 'Layout Saved', 'Indicators, drawing lines, and layout preferences successfully saved.');
    });
  }
}

function updateIndicatorsUI() {
  const indicatorOptions = document.querySelectorAll('.indicator-option');
  indicatorOptions.forEach(opt => {
    const indicator = opt.getAttribute('data-indicator');
    if (enabledIndicators[indicator]) {
      opt.classList.add('active');
    } else {
      opt.classList.remove('active');
    }
  });

  if (ema9Series) ema9Series.applyOptions({ visible: enabledIndicators.ema9 });
  if (ema21Series) ema21Series.applyOptions({ visible: enabledIndicators.ema21 });
  if (bbUpperSeries) bbUpperSeries.applyOptions({ visible: enabledIndicators.bb });
  if (bbBasisSeries) bbBasisSeries.applyOptions({ visible: enabledIndicators.bb });
  if (bbLowerSeries) bbLowerSeries.applyOptions({ visible: enabledIndicators.bb });
}

function updateChartTypeUI() {
  const typeOptions = document.querySelectorAll('.type-option');
  typeOptions.forEach(opt => {
    const type = opt.getAttribute('data-type');
    if (currentChartType === type) {
      opt.classList.add('active');
    } else {
      opt.classList.remove('active');
    }
  });

  const labelMap = {
    candles: 'Candles',
    line: 'Line / Area',
    bars: 'OHLC Bars'
  };
  const labelEl = document.getElementById('chart-type-label');
  if (labelEl) {
    labelEl.textContent = labelMap[currentChartType] || 'Candles';
  }

  if (candlestickSeries) candlestickSeries.applyOptions({ 
    visible: currentChartType === 'candles',
    priceLineVisible: currentChartType === 'candles',
    lastValueVisible: currentChartType === 'candles'
  });
  if (areaSeries) areaSeries.applyOptions({ 
    visible: currentChartType === 'line',
    priceLineVisible: currentChartType === 'line',
    lastValueVisible: currentChartType === 'line'
  });
  if (barSeries) barSeries.applyOptions({ 
    visible: currentChartType === 'bars',
    priceLineVisible: currentChartType === 'bars',
    lastValueVisible: currentChartType === 'bars'
  });

  reloadChartData();
}

function loadSavedLayout() {
  const saved = localStorage.getItem('bitstar_chart_layout');
  if (saved) {
    try {
      const layout = JSON.parse(saved);
      if (layout.indicators) {
        enabledIndicators = layout.indicators;
      }
      if (layout.drawings) {
        drawings = layout.drawings;
      }
      if (layout.chartType) {
        currentChartType = layout.chartType;
      }
      if (layout.volumeVisible !== undefined) {
        isVolumeVisible = layout.volumeVisible;
        const toggleVol = document.getElementById('toggle-volume-setting');
        if (toggleVol) {
          toggleVol.checked = isVolumeVisible;
        }
        if (volumeSeries) {
          volumeSeries.applyOptions({ visible: isVolumeVisible });
        }
      }
      updateIndicatorsUI();
      updateChartTypeUI();
    } catch (e) {
      console.error('Failed to parse saved chart layout:', e);
    }
  }
}


// Helper: Empty Row Generator
function createEmptyRow(colSpan, msg) {
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.setAttribute('colspan', colSpan.toString());
  td.className = 'empty-table';
  td.textContent = msg;
  tr.appendChild(td);
  return tr;
}

// Local mock standard session helper
const currentUser = { username: 'Demo User', role: 'USER', balance: 10000.00 };
const activeBalanceSource = 'demo';
function getCsrfToken() { return ''; }

// Instruments sidebar panel implementation
function renderInstrumentsList() {
  const container = document.getElementById('instruments-list-container');
  if (!container) return;

  container.innerHTML = '';
  
  const coins = marketEngine.coins;
  const activeMappedSymbol = getMappedSymbol();

  Object.keys(coins).forEach(symbol => {
    const coin = coins[symbol];
    
    // Determine category and badge
    let category = 'cfd';
    let badgeText = 'CFD';
    if (symbol === 'BTC/USDT' || symbol === 'ETH/USDT') {
      category = 'futures';
      badgeText = 'Futures';
    }

    // Friendly display name
    let friendlyName = symbol.replace('/USDT', '');
    if (friendlyName === 'EUR') friendlyName = 'EUR/USD';
    if (friendlyName === 'XAU') friendlyName = 'XAU/USD';
    if (friendlyName === 'XAG') friendlyName = 'XAG/USD';
    
    const item = document.createElement('div');
    item.className = `instrument-item ${symbol === activeMappedSymbol ? 'active' : ''}`;
    item.setAttribute('data-symbol', symbol);
    item.setAttribute('data-category', category);
    
    const dec = coin.decimalPlaces;
    const currentPrice = coin.currentPrice;
    const lastClose = coin.yesterdayPrice || currentPrice;
    const change = currentPrice - lastClose;
    const changePct = (change / lastClose) * 100;
    const isUp = change >= 0;

    const iconColor = coin.icon === '₿' ? '#ff9f0a' : coin.icon === 'Ξ' ? '#a48df6' : coin.icon === '💵' ? '#0a84ff' : coin.icon === '🪙' ? '#ffd60a' : coin.icon === '🥈' ? '#e2e8f0' : '#bf5af2';

    item.innerHTML = `
      <div class="instrument-left">
        <div class="instrument-icon" style="color: ${iconColor};">${coin.icon}</div>
        <div class="instrument-meta">
          <div class="instrument-symbol">${friendlyName}</div>
          <div class="instrument-badge ${category}">${badgeText}</div>
        </div>
      </div>
      <div class="instrument-right">
        <div class="instrument-price font-mono">${currentPrice.toFixed(dec)}</div>
        <div class="instrument-change font-mono ${isUp ? 'up' : 'down'}">${isUp ? '+' : ''}${changePct.toFixed(2)}%</div>
      </div>
    `;

    item.addEventListener('click', () => {
      let activeSymbolName = friendlyName.replace('/', '');
      if (friendlyName === 'EUR/USD') activeSymbolName = 'EURUSD';
      if (friendlyName === 'XAU/USD') activeSymbolName = 'XAUUSD';
      if (friendlyName === 'XAG/USD') activeSymbolName = 'XAGUSD';
      
      let tabElement = document.querySelector(`.asset-tab[data-symbol="${activeSymbolName}"]`);
      if (!tabElement) {
        const assetTabsContainer = document.querySelector('.asset-tabs');
        const addBtn = document.querySelector('.add-tab-btn');
        if (assetTabsContainer && addBtn) {
          tabElement = document.createElement('div');
          tabElement.className = 'asset-tab';
          tabElement.setAttribute('data-symbol', activeSymbolName);
          
          let iconColor = '#ffd60a';
          if (activeSymbolName.startsWith('BTC')) iconColor = '#ff9f0a';
          else if (activeSymbolName.startsWith('ETH')) iconColor = '#a48df6';
          else if (activeSymbolName.startsWith('EUR')) iconColor = '#0a84ff';
          else if (activeSymbolName.startsWith('XAU')) iconColor = '#ffd60a';
          else if (activeSymbolName.startsWith('USOIL')) iconColor = '#bf5af2';
          else if (activeSymbolName.startsWith('XAG')) iconColor = '#e2e8f0';

          const coinIconSpan = document.createElement('span');
          coinIconSpan.className = 'coin-icon';
          coinIconSpan.style.color = iconColor;
          coinIconSpan.textContent = coin.icon || '🪙';
          
          const symbolTextSpan = document.createElement('span');
          symbolTextSpan.className = 'tab-symbol-text';
          symbolTextSpan.textContent = friendlyName;

          const volatilitySpan = document.createElement('span');
          volatilitySpan.className = 'volatility-indicator';
          volatilitySpan.textContent = 'III';

          const closeSpan = document.createElement('span');
          closeSpan.className = 'tab-close';
          closeSpan.textContent = '×';

          tabElement.appendChild(coinIconSpan);
          tabElement.appendChild(symbolTextSpan);
          tabElement.appendChild(volatilitySpan);
          tabElement.appendChild(closeSpan);

          tabElement.addEventListener('click', (e) => {
            const targetSymbol = tabElement.getAttribute('data-symbol');
            switchAsset(targetSymbol, tabElement);
          });
          
          closeSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            handleCloseTab(tabElement);
          });

          assetTabsContainer.insertBefore(tabElement, addBtn);
        }
      }
      
      if (tabElement) {
        switchAsset(activeSymbolName, tabElement);
      }
      
      document.querySelectorAll('.instrument-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    });

    container.appendChild(item);
  });

  filterInstrumentsList();
}

function filterInstrumentsList() {
  const searchInput = document.getElementById('instruments-search-input');
  const searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : '';
  
  const activeBtn = document.querySelector('#instruments-sidebar-panel .filter-btn.active');
  const activeCategory = activeBtn ? activeBtn.getAttribute('data-category') : 'all';

  const items = document.querySelectorAll('.instrument-item');
  items.forEach(item => {
    const symbol = item.querySelector('.instrument-symbol').textContent.toLowerCase();
    const category = item.getAttribute('data-category');

    const matchesSearch = symbol.includes(searchQuery);
    const matchesCategory = activeCategory === 'all' || category === activeCategory;

    if (matchesSearch && matchesCategory) {
      item.classList.remove('hidden');
    } else {
      item.classList.add('hidden');
    }
  });
}

function updateInstrumentsPrices(coins) {
  const container = document.getElementById('instruments-list-container');
  if (!container || container.children.length === 0) return;

  const activeMappedSymbol = getMappedSymbol();

  Object.keys(coins).forEach(symbol => {
    const coin = coins[symbol];
    const item = container.querySelector(`.instrument-item[data-symbol="${symbol}"]`);
    if (!item) return;

    if (symbol === activeMappedSymbol) {
      if (!item.classList.contains('active')) {
        document.querySelectorAll('.instrument-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
      }
    } else {
      item.classList.remove('active');
    }

    const dec = coin.decimalPlaces;
    const currentPrice = coin.currentPrice;
    const lastClose = coin.yesterdayPrice || currentPrice;
    const change = currentPrice - lastClose;
    const changePct = (change / lastClose) * 100;
    const isUp = change >= 0;

    const priceEl = item.querySelector('.instrument-price');
    const changeEl = item.querySelector('.instrument-change');

    if (priceEl) priceEl.textContent = currentPrice.toFixed(dec);
    if (changeEl) {
      changeEl.textContent = `${isUp ? '+' : ''}${changePct.toFixed(2)}%`;
      changeEl.className = `instrument-change font-mono ${isUp ? 'up' : 'down'}`;
    }
  });
}

