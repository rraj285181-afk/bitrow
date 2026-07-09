import './style.css';
import { createChart, CandlestickSeries, HistogramSeries, AreaSeries, BarSeries, LineSeries } from 'lightweight-charts';
import { marketEngine } from './mockMarket';
import { tradingEngine } from './tradingEngine';

// Sound Effects Synthesizer using Web Audio API
class SoundEffects {
  static init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn("Web Audio API not supported in this browser:", e);
    }
  }

  static playSuccess() {
    try {
      if (!this.ctx) this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
      osc.frequency.setValueAtTime(783.99, now + 0.16); // G5

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.start(now);
      osc.stop(now + 0.35);
    } catch (e) {
      console.warn("Sound play success failed:", e);
    }
  }

  static playAlert() {
    try {
      if (!this.ctx) this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const now = this.ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, now + i * 0.22);
        gain.gain.setValueAtTime(0.06, now + i * 0.22);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.22 + 0.18);
        osc.start(now + i * 0.22);
        osc.stop(now + i * 0.22 + 0.18);
      }
    } catch (e) {
      console.warn("Sound play alert failed:", e);
    }
  }

  static playCancel() {
    try {
      if (!this.ctx) this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(329.63, now); // E4
      osc.frequency.exponentialRampToValueAtTime(164.81, now + 0.2); // E3

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc.start(now);
      osc.stop(now + 0.2);
    } catch (e) {
      console.warn("Sound play cancel failed:", e);
    }
  }
}

// Global state tracking for sounds
let lastPositionsLength = null;
let lastPendingOrdersLength = null;

// Global state
let activeSymbol = 'EURUSD';
let activeTimeframe = 5; // 5m default like in screenshot
let currentOrderType = 'MARKET'; // 'MARKET' or 'LIMIT'
let isBuyActive = null; // BUY, SELL, or null (neutral)
let lotSizeValue = 0.01;
let currentFormMode = 'regular'; // 'regular', 'oneclick', or 'riskcalc'

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
let activeAlerts = [];
let triggeredAlerts = [];
let isPickingAlertPrice = false;
let setDrawingTool = null; // Global setter initialized in initChartUIPanels

// Initialize when DOM loaded
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  // Register notification bridge
  tradingEngine.registerNotificationCallback(showToast);

  // Initialize UI Bindings
  initAssetTabs();
  initPortfolioTabs();
  initTimeframes();
  initTradingForm();
  initChart();
  startLiveClock();
  // startLatencySimulator();

  // New features initializers
  initHistoryExporter();
  initWeb3Deposit();
  initWeb3Withdraw();
  initAdminPanel();

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

  // Initialize Google Login
  initGoogleAuth();

  // Instruments, Alerts & Settings sidebar panel bindings
  const instrumentsBtn = document.getElementById('sidebar-btn-instruments');
  const instrumentsPanel = document.getElementById('instruments-sidebar-panel');
  const alertsBtn = document.getElementById('sidebar-btn-alerts');
  const alertsPanel = document.getElementById('alerts-sidebar-panel');
  const settingsBtn = document.getElementById('sidebar-btn-settings');
  const settingsPanel = document.getElementById('settings-sidebar-panel');

  console.log('Sidebar elements initialized:', {
    instrumentsBtn: !!instrumentsBtn,
    instrumentsPanel: !!instrumentsPanel,
    alertsBtn: !!alertsBtn,
    alertsPanel: !!alertsPanel,
    settingsBtn: !!settingsBtn,
    settingsPanel: !!settingsPanel
  });

  function updateSidebarActiveStates() {
    if (instrumentsBtn) {
      if (instrumentsPanel && !instrumentsPanel.classList.contains('hidden')) {
        instrumentsBtn.classList.add('active');
      } else {
        instrumentsBtn.classList.remove('active');
      }
    }
    if (alertsBtn) {
      if (alertsPanel && !alertsPanel.classList.contains('hidden')) {
        alertsBtn.classList.add('active');
      } else {
        alertsBtn.classList.remove('active');
      }
    }
    if (settingsBtn) {
      if (settingsPanel && !settingsPanel.classList.contains('hidden')) {
        settingsBtn.classList.add('active');
      } else {
        settingsBtn.classList.remove('active');
      }
    }
  }

  if (instrumentsBtn && instrumentsPanel) {
    instrumentsBtn.addEventListener('click', () => {
      console.log('Instruments button clicked, toggle hidden. Current state:', instrumentsPanel.classList.contains('hidden'));
      instrumentsPanel.classList.toggle('hidden');
      if (!instrumentsPanel.classList.contains('hidden')) {
        if (alertsPanel) alertsPanel.classList.add('hidden');
        if (settingsPanel) settingsPanel.classList.add('hidden');
        renderInstrumentsList();
      }
      updateSidebarActiveStates();
    });
  } else {
    console.warn('sidebar-btn-instruments or instruments-sidebar-panel missing!');
  }

  if (alertsBtn && alertsPanel) {
    alertsBtn.addEventListener('click', () => {
      console.log('Price Alerts button clicked, toggle hidden. Current state:', alertsPanel.classList.contains('hidden'));
      alertsPanel.classList.toggle('hidden');
      if (!alertsPanel.classList.contains('hidden')) {
        if (instrumentsPanel) instrumentsPanel.classList.add('hidden');
        if (settingsPanel) settingsPanel.classList.add('hidden');
        renderAlertsList();
        populateAlertSymbolSelect();
      }
      updateSidebarActiveStates();
    });
  } else {
    console.warn('sidebar-btn-alerts or alerts-sidebar-panel missing!');
  }

  if (settingsBtn && settingsPanel) {
    settingsBtn.addEventListener('click', () => {
      console.log('Settings button clicked, toggle hidden. Current state:', settingsPanel.classList.contains('hidden'));
      settingsPanel.classList.toggle('hidden');
      if (!settingsPanel.classList.contains('hidden')) {
        if (instrumentsPanel) instrumentsPanel.classList.add('hidden');
        if (alertsPanel) alertsPanel.classList.add('hidden');
        const toggleVolumeSetting = document.getElementById('toggle-volume-setting');
        if (toggleVolumeSetting) {
          toggleVolumeSetting.checked = isVolumeVisible;
        }
      }
      updateSidebarActiveStates();
    });
  } else {
    console.warn('sidebar-btn-settings or settings-sidebar-panel missing!');
  }

  const createAlertBtn = document.getElementById('create-alert-btn');
  if (createAlertBtn) {
    createAlertBtn.addEventListener('click', handleCreateAlert);
  }

  const clearAllAlertsBtn = document.getElementById('clear-all-alerts-btn');
  if (clearAllAlertsBtn) {
    clearAllAlertsBtn.addEventListener('click', () => {
      activeAlerts = [];
      saveAlerts();
      renderAlertsList();
      updateChartPriceLines(tradingEngine.positions, tradingEngine.pendingOrders);
      showToast('info', 'Alerts Cleared', 'All active price alerts have been cleared.');
    });
  }

  const alertPickerBtn = document.getElementById('alert-chart-picker-btn');
  if (alertPickerBtn) {
    alertPickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isPickingAlertPrice = !isPickingAlertPrice;
      isPickingTp = false;
      isPickingSl = false;

      const tpPicker = document.getElementById('tp-chart-picker');
      const slPicker = document.getElementById('sl-chart-picker');
      if (tpPicker) tpPicker.classList.remove('picking');
      if (slPicker) slPicker.classList.remove('picking');

      const chartContainer = document.getElementById('chart-container');
      if (isPickingAlertPrice) {
        alertPickerBtn.classList.add('alert-picker-active');
        if (chartContainer) chartContainer.style.cursor = 'crosshair';
        showToast('info', 'Price Alert Selection', 'Click on the chart to set your trigger price.');
      } else {
        alertPickerBtn.classList.remove('alert-picker-active');
        if (chartContainer) chartContainer.style.cursor = 'default';
      }
    });
  }

  // Load saved alerts
  loadAlerts();

  // Settings change listener
  const toggleVolumeSetting = document.getElementById('toggle-volume-setting');

  if (toggleVolumeSetting) {
    toggleVolumeSetting.addEventListener('change', (e) => {
      isVolumeVisible = e.target.checked;
      if (volumeSeries) {
        volumeSeries.applyOptions({ visible: isVolumeVisible });
      }

      let saved = null;
      try {
        saved = localStorage.getItem('bitstar_chart_layout');
      } catch (err) {
        console.warn("Failed to read layout from localStorage:", err);
      }
      let layout = {};
      if (saved) {
        try {
          layout = JSON.parse(saved);
        } catch (err) { }
      }
      layout.volumeVisible = isVolumeVisible;
      try {
        localStorage.setItem('bitstar_chart_layout', JSON.stringify(layout));
      } catch (err) {
        console.warn("Failed to write layout to localStorage:", err);
      }

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

  // Reset real account button
  const resetBtn = document.getElementById('reset-account-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      tradingEngine.resetAccount();
      showToast('success', 'Account Reset', 'Real account balance reset to $10,000.00 USD.');
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

function initPortfolioTabs() {
  const tabs = document.querySelectorAll('.portfolio-tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      const targetTab = e.currentTarget.getAttribute('data-tab');

      // Update tab buttons active state
      tabs.forEach(t => t.classList.remove('active'));
      e.currentTarget.classList.add('active');

      // Update tab contents active state
      const contentItems = document.querySelectorAll('.portfolio-tab-content-item');
      contentItems.forEach(item => {
        const itemTabName = item.id.replace('portfolio-tab-', '');
        if (itemTabName === targetTab) {
          item.classList.add('active');
          item.style.display = 'block';
        } else {
          item.classList.remove('active');
          item.style.display = 'none';
        }
      });

      // Auto expand portfolio panel if it was collapsed when clicking a tab
      const portfolioPanel = document.querySelector('.bottom-portfolio-panel');
      if (portfolioPanel && portfolioPanel.classList.contains('collapsed')) {
        portfolioPanel.classList.remove('collapsed');
        resizeChartArea();
      }
    });
  });

  // Collapse/Expand Caret Toggle
  const collapseBtn = document.getElementById('portfolio-collapse-btn');
  const portfolioPanel = document.querySelector('.bottom-portfolio-panel');
  if (collapseBtn && portfolioPanel) {
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      portfolioPanel.classList.toggle('collapsed');
      resizeChartArea();
    });
  }
}

function resizeChartArea() {
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


function showRightWorkspace() {
  const rw = document.querySelector('.right-workspace');
  if (rw) {
    rw.classList.remove('hidden');
    setTimeout(() => {
      if (chart) {
        const container = document.getElementById('chart-container');
        if (container) {
          chart.resize(container.clientWidth, container.clientHeight);
        }
      }
    }, 300);
  }
}

function hideRightWorkspace() {
  const rw = document.querySelector('.right-workspace');
  if (rw) {
    rw.classList.add('hidden');
    setTimeout(() => {
      if (chart) {
        const container = document.getElementById('chart-container');
        if (container) {
          chart.resize(container.clientWidth, container.clientHeight);
        }
      }
    }, 300);
  }
}

function switchAsset(symbol, tabElement) {
  if (tradingEngine.isGuest) {
    hideRightWorkspace();
  } else {
    showRightWorkspace();
  }

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
  lotSizeValue = 0.01;
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

function getLotMultiplier(symbol) {
  const sym = symbol || activeSymbol;
  if (!sym) return 1.0;
  if (sym.startsWith('BTC')) return 1.0;     // 1 BTC per lot
  if (sym.startsWith('ETH')) return 10.0;    // 10 ETH per lot
  if (sym.startsWith('EUR')) return 100000.0; // 100,000 EUR per lot
  if (sym.startsWith('XAU')) return 100.0;    // 100 oz of Gold per lot
  if (sym.startsWith('XAG')) return 5000.0;   // 5,000 oz of Silver per lot
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
let _chartResizeObserver = null; // module-level reference to disconnect on re-init

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

  // Disconnect any previous ResizeObserver before creating a new one
  if (_chartResizeObserver) {
    _chartResizeObserver.disconnect();
    _chartResizeObserver = null;
  }

  _chartResizeObserver = new ResizeObserver(entries => {
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
  _chartResizeObserver.observe(container);

  // Bind chart navigation overlay controls
  const zoomInBtn = document.getElementById('chart-nav-zoom-in');
  const zoomOutBtn = document.getElementById('chart-nav-zoom-out');
  const navLeftBtn = document.getElementById('chart-nav-left');
  const navRightBtn = document.getElementById('chart-nav-right');
  const navResetBtn = document.getElementById('chart-nav-reset');

  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => {
      const ts = chart.timeScale();
      ts.applyOptions({ barSpacing: ts.options().barSpacing * 1.25 });
    });
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => {
      const ts = chart.timeScale();
      ts.applyOptions({ barSpacing: Math.max(0.5, ts.options().barSpacing / 1.25) });
    });
  }
  if (navLeftBtn) {
    navLeftBtn.addEventListener('click', () => {
      const ts = chart.timeScale();
      ts.scrollToPosition(ts.scrollPosition() - 15, true);
    });
  }
  if (navRightBtn) {
    navRightBtn.addEventListener('click', () => {
      const ts = chart.timeScale();
      ts.scrollToPosition(ts.scrollPosition() + 15, true);
    });
  }
  if (navResetBtn) {
    navResetBtn.addEventListener('click', () => {
      chart.timeScale().resetTimeScale();
      chart.timeScale().scrollToRealTime();
    });
  }

  // Bind right-click and double-click handlers for interactive SL/TP chart context menu
  container.addEventListener('dblclick', (e) => {
    if (isPickingTp || isPickingSl || isPickingAlertPrice || activeDrawingTool) return;
    const rect = container.getBoundingClientRect();
    const y = e.clientY - rect.top;

    const activeSeries = getActiveSeries();
    if (!activeSeries) return;

    const price = activeSeries.coordinateToPrice(y);
    if (!price) return;

    const coin = marketEngine.coins[getMappedSymbol()];
    const dec = coin ? coin.decimalPlaces : 2;
    const formattedPrice = parseFloat(price.toFixed(dec));

    const chartWrapper = document.querySelector('.chart-wrapper');
    if (!chartWrapper) return;
    const wrapperRect = chartWrapper.getBoundingClientRect();
    const x = e.clientX - wrapperRect.left;
    const contextY = e.clientY - wrapperRect.top;

    showChartContextMenu(x, contextY, formattedPrice);
  });

  container.addEventListener('contextmenu', (e) => {
    if (isPickingTp || isPickingSl || isPickingAlertPrice || activeDrawingTool) return;
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const y = e.clientY - rect.top;

    const activeSeries = getActiveSeries();
    if (!activeSeries) return;

    const price = activeSeries.coordinateToPrice(y);
    if (!price) return;

    const coin = marketEngine.coins[getMappedSymbol()];
    const dec = coin ? coin.decimalPlaces : 2;
    const formattedPrice = parseFloat(price.toFixed(dec));

    const chartWrapper = document.querySelector('.chart-wrapper');
    if (!chartWrapper) return;
    const wrapperRect = chartWrapper.getBoundingClientRect();
    const x = e.clientX - wrapperRect.left;
    const contextY = e.clientY - wrapperRect.top;

    showChartContextMenu(x, contextY, formattedPrice);
  });

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

    // Handle Alert picking
    if (isPickingAlertPrice) {
      document.getElementById('alert-price-input').value = formattedPrice;
      isPickingAlertPrice = false;
      document.getElementById('alert-chart-picker-btn').classList.remove('alert-picker-active');
      container.style.cursor = 'default';
      showToast('success', 'Alert Price Set', `Alert price set to ${formattedPrice} from chart.`);
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

  const customTfInput = document.getElementById('custom-tf-minutes');
  const customTfApply = document.getElementById('custom-tf-apply-btn');

  if (customTfInput && customTfApply) {
    customTfApply.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = parseInt(customTfInput.value);
      if (isNaN(val) || val <= 0) return;

      // Check if this option already exists
      let existingOpt = dropdown.querySelector(`.tf-option[data-tf="${val}"]`);
      if (!existingOpt) {
        // Create new option
        const newOpt = document.createElement('div');
        newOpt.className = 'tf-option font-mono';
        newOpt.setAttribute('data-tf', val.toString());
        newOpt.textContent = val >= 60 ? (val % 60 === 0 ? `${val / 60}h` : `${val}m`) : `${val}m`;

        // Insert before the custom input container
        const inputContainer = dropdown.querySelector('.custom-tf-input-container');
        dropdown.insertBefore(newOpt, inputContainer);

        // Attach click listener
        newOpt.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const allOpts = dropdown.querySelectorAll('.tf-option');
          allOpts.forEach(o => o.classList.remove('active'));
          newOpt.classList.add('active');
          activeTimeframe = val;
          label.textContent = newOpt.textContent;
          dropdown.classList.add('hidden');
          reloadChartData();
        });

        existingOpt = newOpt;
      }

      // Trigger click on it to select it automatically
      existingOpt.click();
      customTfInput.value = '';
    });
  }

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

  async function updateRealLatency() {
    try {
      const start = performance.now();
      const res = await fetch('/api-hyperliquid/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'meta' })
      });
      if (res.ok) {
        const lat = Math.round(performance.now() - start);
        if (tradingEngine.isLoaded) {
          latencyEl.textContent = `${lat} ms`;
          latencyEl.style.display = 'inline';
        }
      } else {
        if (tradingEngine.isLoaded) {
          latencyEl.textContent = '-- ms';
          latencyEl.style.display = 'inline';
        }
      }
    } catch (err) {
      if (tradingEngine.isLoaded) {
        latencyEl.textContent = 'Offline';
        latencyEl.style.display = 'inline';
      }
    }
  }

  updateRealLatency();
  setInterval(updateRealLatency, 5000);
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

  // Form Selector Dropdown setup
  const formSelectorTrigger = document.getElementById('form-selector-trigger');
  const formSelectorDropdownMenu = document.getElementById('form-selector-dropdown-menu');
  const formSelectorLabel = document.getElementById('form-selector-label');

  if (formSelectorTrigger && formSelectorDropdownMenu) {
    formSelectorTrigger.addEventListener('click', (e) => {
      // Toggle dropdown visibility
      if (e.target.classList.contains('form-select-option')) return;
      formSelectorDropdownMenu.classList.toggle('hidden');
    });

    const options = formSelectorDropdownMenu.querySelectorAll('.form-select-option');
    options.forEach(option => {
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        options.forEach(o => o.classList.remove('active'));
        option.classList.add('active');
        formSelectorLabel.textContent = option.textContent;
        switchFormMode(option.getAttribute('data-value'));
        formSelectorDropdownMenu.classList.add('hidden');
      });
    });

    document.addEventListener('click', (e) => {
      if (!formSelectorTrigger.contains(e.target)) {
        formSelectorDropdownMenu.classList.add('hidden');
      }
    });
  }

  // Split buy/sell triggers
  sellTriggerBox.addEventListener('click', () => {
    if (currentFormMode === 'oneclick') {
      isBuyActive = false;
      handleExecuteOrder();
      isBuyActive = null;
      sellTriggerBox.classList.remove('active');
      buyTriggerBox.classList.remove('active');
      executeUpdateButtonUI();
    } else {
      isBuyActive = false;
      sellTriggerBox.classList.add('active');
      buyTriggerBox.classList.remove('active');
      executeUpdateButtonUI();
      updateOrderCalculations();
    }
  });

  buyTriggerBox.addEventListener('click', () => {
    if (currentFormMode === 'oneclick') {
      isBuyActive = true;
      handleExecuteOrder();
      isBuyActive = null;
      sellTriggerBox.classList.remove('active');
      buyTriggerBox.classList.remove('active');
      executeUpdateButtonUI();
    } else {
      isBuyActive = true;
      buyTriggerBox.classList.add('active');
      sellTriggerBox.classList.remove('active');
      executeUpdateButtonUI();
      updateOrderCalculations();
    }
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

    // Hide trading terminal right panel
    const rightWorkspacePanel = document.querySelector('.right-workspace');
    if (rightWorkspacePanel) {
      rightWorkspacePanel.classList.add('hidden');
      setTimeout(() => {
        if (chart) {
          const container = document.getElementById('chart-container');
          if (container) {
            chart.resize(container.clientWidth, container.clientHeight);
          }
        }
      }, 300);
    }
  });

  // Close terminal button binding
  const closeTerminalBtn = document.querySelector('.close-terminal-btn');
  const rightWorkspace = document.querySelector('.right-workspace');
  if (closeTerminalBtn && rightWorkspace) {
    closeTerminalBtn.addEventListener('click', () => {
      console.log('Close terminal panel clicked.');
      rightWorkspace.classList.add('hidden');
      setTimeout(() => {
        if (chart) {
          const container = document.getElementById('chart-container');
          if (container) {
            chart.resize(container.clientWidth, container.clientHeight);
          }
        }
      }, 300);
    });
  }
}

function switchFormMode(mode) {
  currentFormMode = mode;

  const riskCalcGroup = document.getElementById('risk-calc-group');
  if (mode === 'riskcalc') {
    if (riskCalcGroup) riskCalcGroup.classList.remove('hidden');
  } else {
    if (riskCalcGroup) riskCalcGroup.classList.add('hidden');
  }

  // Adjust volume inputs readonly / disabled state in riskcalc mode
  const volInput = document.getElementById('order-volume-input');
  const volMinus = document.getElementById('volume-minus');
  const volPlus = document.getElementById('volume-plus');
  if (mode === 'riskcalc') {
    if (volInput) volInput.readOnly = true;
    if (volMinus) volMinus.disabled = true;
    if (volPlus) volPlus.disabled = true;
  } else {
    if (volInput) volInput.readOnly = false;
    if (volMinus) volMinus.disabled = false;
    if (volPlus) volPlus.disabled = false;
  }

  if (mode === 'oneclick') {
    isBuyActive = null;
    const sellTrigger = document.getElementById('action-sell-trigger');
    const buyTrigger = document.getElementById('action-buy-trigger');
    if (sellTrigger) sellTrigger.classList.remove('active');
    if (buyTrigger) buyTrigger.classList.remove('active');
    executeUpdateButtonUI();
    showToast('info', 'One-Click Form Enabled', 'Clicking Buy or Sell will place orders instantly without confirmation.');
  } else if (mode === 'riskcalc') {
    showToast('info', 'Risk Calculator Enabled', 'Volume is automatically calculated based on Risk % of Balance and Stop Loss distance.');
    updateOrderCalculations();
  } else {
    showToast('info', 'Regular Form Enabled', 'Confirm your trades manually before execution.');
    updateOrderCalculations();
  }
}

function setupPlusMinusListeners() {
  const volInput = document.getElementById('order-volume-input');
  const pendingInput = document.getElementById('pending-price-input');
  const tpInput = document.getElementById('tp-price-input');
  const slInput = document.getElementById('sl-price-input');

  // Volume
  document.getElementById('volume-plus').addEventListener('click', () => {
    if (currentFormMode === 'riskcalc') return;
    lotSizeValue = Math.min(100, lotSizeValue + 0.05);
    volInput.value = lotSizeValue.toFixed(2);
    executeUpdateButtonUI();
    updateOrderCalculations();
  });
  document.getElementById('volume-minus').addEventListener('click', () => {
    if (currentFormMode === 'riskcalc') return;
    lotSizeValue = Math.max(0.01, lotSizeValue - 0.05);
    volInput.value = lotSizeValue.toFixed(2);
    executeUpdateButtonUI();
    updateOrderCalculations();
  });
  volInput.addEventListener('change', () => {
    if (currentFormMode === 'riskcalc') return;
    lotSizeValue = Math.max(0.01, parseFloat(volInput.value) || 0.01);
    volInput.value = lotSizeValue.toFixed(2);
    executeUpdateButtonUI();
    updateOrderCalculations();
  });

  // Risk percentage controls
  const riskInput = document.getElementById('risk-percentage-input');
  if (riskInput) {
    document.getElementById('risk-plus').addEventListener('click', () => {
      let val = parseFloat(riskInput.value) || 1.0;
      val = Math.min(10.0, val + 0.1);
      riskInput.value = val.toFixed(1);
      updateOrderCalculations();
    });
    document.getElementById('risk-minus').addEventListener('click', () => {
      let val = parseFloat(riskInput.value) || 1.0;
      val = Math.max(0.1, val - 0.1);
      riskInput.value = val.toFixed(1);
      updateOrderCalculations();
    });
    riskInput.addEventListener('change', () => {
      let val = parseFloat(riskInput.value) || 1.0;
      val = Math.max(0.1, Math.min(10.0, val));
      riskInput.value = val.toFixed(1);
      updateOrderCalculations();
    });
  }

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

  // If risk calculator is active, automatically calculate the lot size before proceeding
  if (currentFormMode === 'riskcalc') {
    const riskPercent = parseFloat(document.getElementById('risk-percentage-input').value) || 1.0;
    const balance = tradingEngine.balance || 10000.00;
    const riskUsd = balance * (riskPercent / 100);

    // Update Risk Amount display
    const riskAmountDisplay = document.getElementById('risk-amount-display');
    if (riskAmountDisplay) {
      riskAmountDisplay.textContent = `${riskUsd.toFixed(2)} USD`;
    }

    const slVal = parseFloat(document.getElementById('sl-price-input').value) || 0;
    if (slVal > 0) {
      const priceDiff = Math.abs(price - slVal);
      if (priceDiff > 0) {
        const lotMultiplier = getLotMultiplier();
        const lossPerLot = priceDiff * lotMultiplier;
        let calculatedLots = riskUsd / lossPerLot;

        // Cap calculated lots to max 100 and min 0.01
        calculatedLots = Math.max(0.01, Math.min(100.0, calculatedLots));

        lotSizeValue = calculatedLots;
        const volInput = document.getElementById('order-volume-input');
        if (volInput) {
          volInput.value = lotSizeValue.toFixed(2);
        }
      }
    } else {
      if (riskAmountDisplay) {
        riskAmountDisplay.textContent = `${riskUsd.toFixed(2)} USD (Set SL)`;
      }
    }
  }

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
    tpMetrics.textContent = `${usd >= 0 ? '+' : ''}${pips.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pips | ${usd >= 0 ? '+' : ''}${usd.toFixed(2)} USD | ${usd >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
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
    slMetrics.textContent = `${usd >= 0 ? '+' : ''}${pips.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pips | ${usd >= 0 ? '+' : ''}${usd.toFixed(2)} USD | ${usd >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
    slMetrics.className = `tp-sl-metrics ${usd >= 0 ? 'profit' : 'loss'}`;
  } else {
    slMetrics.classList.add('hidden');
  }
}

function handleExecuteOrder() {
  if (tradingEngine.isGuest) {
    showToast('warning', 'Authentication Required', 'Please Sign In with Google to place trades.');
    return;
  }

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
// Price Alerts Engine
// ----------------------------------------------------
function loadAlerts() {
  try {
    const savedActive = localStorage.getItem('bitstar_active_alerts_v1');
    const savedTriggered = localStorage.getItem('bitstar_triggered_alerts_v1');
    activeAlerts = savedActive ? JSON.parse(savedActive) : [];
    triggeredAlerts = savedTriggered ? JSON.parse(savedTriggered) : [];
  } catch (e) {
    console.error("Failed to load alerts from localStorage:", e);
    activeAlerts = [];
    triggeredAlerts = [];
  }
}

function saveAlerts() {
  try {
    localStorage.setItem('bitstar_active_alerts_v1', JSON.stringify(activeAlerts));
    localStorage.setItem('bitstar_triggered_alerts_v1', JSON.stringify(triggeredAlerts));
  } catch (e) {
    console.error("Failed to save alerts to localStorage:", e);
  }
}

function playAlertSound() {
  SoundEffects.playAlert();
}

function renderAlertsList() {
  const activeList = document.getElementById('active-alerts-list');
  const triggeredList = document.getElementById('triggered-alerts-list');
  if (!activeList || !triggeredList) return;

  activeList.innerHTML = '';
  if (activeAlerts.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.color = 'var(--text-muted)';
    emptyMsg.style.fontSize = '10px';
    emptyMsg.style.textAlign = 'center';
    emptyMsg.style.padding = '12px 0';
    emptyMsg.textContent = 'No active alerts.';
    activeList.appendChild(emptyMsg);
  } else {
    activeAlerts.forEach((alert, index) => {
      const item = document.createElement('div');
      item.className = 'alert-item';

      const left = document.createElement('div');
      left.className = 'alert-item-left';

      const symbol = document.createElement('div');
      symbol.className = 'alert-item-symbol';
      symbol.textContent = alert.symbol;

      const condition = document.createElement('div');
      const isAbove = alert.condition === 'above';
      condition.className = `alert-item-condition ${isAbove ? 'above' : 'below'}`;
      condition.textContent = `${isAbove ? 'Rises above (≥)' : 'Falls below (≤)'} ${alert.price.toFixed(marketEngine.coins[alert.symbol]?.decimalPlaces || 2)}`;

      left.appendChild(symbol);
      left.appendChild(condition);

      const right = document.createElement('div');
      right.className = 'alert-item-right';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'alert-delete-btn';
      deleteBtn.innerHTML = '×';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        activeAlerts.splice(index, 1);
        saveAlerts();
        renderAlertsList();
        updateChartPriceLines(tradingEngine.positions, tradingEngine.pendingOrders);
        showToast('info', 'Alert Deleted', `Alert for ${alert.symbol} removed.`);
      });

      right.appendChild(deleteBtn);

      item.appendChild(left);
      item.appendChild(right);
      activeList.appendChild(item);
    });
  }

  triggeredList.innerHTML = '';
  if (triggeredAlerts.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.textContent = 'No triggered alerts.';
    triggeredList.appendChild(emptyMsg);
  } else {
    triggeredAlerts.forEach(alert => {
      const item = document.createElement('div');
      item.style.padding = '4px 0';
      item.style.borderBottom = '1px solid rgba(255, 255, 255, 0.02)';
      item.style.display = 'flex';
      item.style.justifyContent = 'space-between';

      const timeStr = new Date(alert.triggeredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const text = document.createElement('span');
      text.textContent = `${alert.symbol} reached ${alert.price} (${alert.condition === 'above' ? '≥' : '≤'})`;

      const time = document.createElement('span');
      time.style.color = 'var(--text-muted)';
      time.style.fontSize = '9px';
      time.textContent = timeStr;

      item.appendChild(text);
      item.appendChild(time);
      triggeredList.appendChild(item);
    });
  }
}

function populateAlertSymbolSelect() {
  const select = document.getElementById('alert-symbol-select');
  if (!select) return;

  select.innerHTML = '';
  Object.keys(marketEngine.coins).forEach(sym => {
    const opt = document.createElement('option');
    opt.value = sym;
    opt.textContent = sym;
    if (sym === getMappedSymbol()) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

function handleCreateAlert() {
  const symbolSelect = document.getElementById('alert-symbol-select');
  const conditionSelect = document.getElementById('alert-condition-select');
  const priceInput = document.getElementById('alert-price-input');

  if (!symbolSelect || !conditionSelect || !priceInput) return;

  const symbol = symbolSelect.value;
  const condition = conditionSelect.value;
  const price = parseFloat(priceInput.value);

  if (isNaN(price) || price <= 0) {
    showToast('error', 'Invalid Price', 'Please enter a valid trigger price.');
    return;
  }

  const newAlert = {
    id: 'alt_' + Math.random().toString(36).substring(2, 11),
    symbol,
    condition,
    price,
    createdAt: Date.now()
  };

  activeAlerts.push(newAlert);
  saveAlerts();
  renderAlertsList();
  updateChartPriceLines(tradingEngine.positions, tradingEngine.pendingOrders);

  priceInput.value = '';
  showToast('success', 'Alert Created', `Alert set for ${symbol} at ${price}`);
}

function checkPriceAlerts(coins) {
  let alertsTriggered = false;

  activeAlerts = activeAlerts.filter(alert => {
    const coin = coins[alert.symbol];
    if (!coin) return true;

    const currentPrice = coin.currentPrice;
    let triggered = false;

    if (alert.condition === 'above') {
      if (currentPrice >= alert.price) {
        triggered = true;
      }
    } else if (alert.condition === 'below') {
      if (currentPrice <= alert.price) {
        triggered = true;
      }
    }

    if (triggered) {
      alertsTriggered = true;
      playAlertSound();
      showToast('success', 'Price Alert Triggered', `${alert.symbol} reached ${alert.price} (Current: ${currentPrice.toFixed(coin.decimalPlaces)})`);

      triggeredAlerts.unshift({
        symbol: alert.symbol,
        condition: alert.condition,
        price: alert.price,
        triggeredAt: Date.now()
      });

      if (triggeredAlerts.length > 20) {
        triggeredAlerts.pop();
      }

      return false;
    }

    return true;
  });

  if (alertsTriggered) {
    saveAlerts();
    renderAlertsList();
    updateChartPriceLines(tradingEngine.positions, tradingEngine.pendingOrders);
  }
}

// ----------------------------------------------------
// Ticker Subscriptions
// ----------------------------------------------------
function handleMarketTick(coins) {
  // Check price alerts first
  checkPriceAlerts(coins);
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

  // Update Chart real-time ticking (all 3 series types must be updated)
  if (candlestickSeries && volumeSeries) {
    const history = activeCoin.history[activeTimeframe];
    if (history && history.length > 0) {
      const last = history[history.length - 1];
      const candleUpdate = {
        time: last.time,
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close
      };
      const volumeUpdate = {
        time: last.time,
        value: last.volume,
        color: last.close >= last.open ? 'rgba(16, 128, 255, 0.12)' : 'rgba(226, 82, 65, 0.12)'
      };
      // Always update all series so switching chart type doesn't freeze the last candle
      try { candlestickSeries.update(candleUpdate); } catch (e) { }
      if (areaSeries) {
        try { areaSeries.update({ time: last.time, value: last.close }); } catch (e) { }
      }
      if (barSeries) {
        try { barSeries.update(candleUpdate); } catch (e) { }
      }
      volumeSeries.update(volumeUpdate);
    }
  }

  // Feed price updates to portfolio calculations
  tradingEngine.updateMarketPrices(coins);
}

function handleTradingTick(engine) {
  // Update Bottom Right Status Network Indicator Only
  const latencyIndicator = document.getElementById('latency-indicator');

  if (latencyIndicator) {
    const latencySvg = latencyIndicator.querySelector('svg');

    if (engine.isLoaded === true) {
      latencyIndicator.style.color = '#00c076'; // Green (Connected)
      // Remove animations from SVG bars
      if (latencySvg) {
        latencySvg.querySelectorAll('rect').forEach(rect => {
          rect.removeAttribute('class');
          rect.style.opacity = '1';
        });
      }
    } else if (engine.isLoaded === false) {
      latencyIndicator.style.color = '#ffd60a'; // Yellow (Offline / Local Mode)
      if (latencySvg) {
        // Dim last 4 bars to show weak/no signal
        const rects = latencySvg.querySelectorAll('rect');
        rects.forEach((rect, i) => {
          rect.removeAttribute('class');
          rect.style.opacity = i === 0 ? '1' : '0.25';
        });
      }
    } else {
      // Connecting / Syncing (Purple)
      latencyIndicator.style.color = '#b388ff';
      if (latencySvg) {
        // Animate signal bars sequentially
        const rects = latencySvg.querySelectorAll('rect');
        rects.forEach((rect, i) => {
          rect.style.opacity = '1';
          rect.setAttribute('class', `signal-bar-${i + 1}`);
        });
      }
    }
  }

  // Sound checks based on length changes
  if (lastPositionsLength !== null) {
    if (engine.positions.length > lastPositionsLength) {
      SoundEffects.playSuccess();
    } else if (engine.positions.length < lastPositionsLength) {
      SoundEffects.playCancel();
    }
  }
  if (lastPendingOrdersLength !== null) {
    if (engine.pendingOrders.length > lastPendingOrdersLength) {
      SoundEffects.playSuccess();
    } else if (engine.pendingOrders.length < lastPendingOrdersLength) {
      if (engine.positions.length <= (lastPositionsLength || 0)) {
        SoundEffects.playCancel();
      }
    }
  }
  lastPositionsLength = engine.positions.length;
  lastPendingOrdersLength = engine.pendingOrders.length;

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
  renderPositionsTable(engine.positions);

  // Render pending limit orders table
  renderPendingOrdersTable(engine.pendingOrders);

  // Render closed history table
  renderHistoryTable(engine.history);

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

function renderPositionsTable(positions) {
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
    const lots = pos.volume / getLotMultiplier(pos.symbol);
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

function renderPendingOrdersTable(orders) {
  const tbody = document.getElementById('pending-table-body');
  if (!tbody) return;

  if (orders.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.setAttribute('colspan', '11');
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
    const currentPrice = coin ? coin.currentPrice : 0;

    const tdVolume = document.createElement('td');
    tdVolume.className = 'font-mono';
    const lots = order.volume / getLotMultiplier(order.symbol);
    tdVolume.textContent = lots.toFixed(2);

    const tdOpeningPrice = document.createElement('td');
    tdOpeningPrice.className = 'font-mono';
    tdOpeningPrice.textContent = `${order.targetPrice.toFixed(dec)}`;

    const tdCurrentPrice = document.createElement('td');
    tdCurrentPrice.className = 'font-mono';
    tdCurrentPrice.textContent = `${currentPrice.toFixed(dec)}`;

    const tdTp = document.createElement('td');
    tdTp.className = 'font-mono';
    tdTp.textContent = order.tp ? order.tp.toFixed(dec) : '-';

    const tdSl = document.createElement('td');
    tdSl.className = 'font-mono';
    tdSl.textContent = order.sl ? order.sl.toFixed(dec) : '-';

    const tdOrder = document.createElement('td');
    tdOrder.className = 'font-mono';
    tdOrder.textContent = order.id ? `#${order.id.replace('ord_', '')}` : '-';

    const tdOpenTime = document.createElement('td');
    tdOpenTime.className = 'font-mono';
    tdOpenTime.textContent = formatBitstarDateTime(order.timestamp);

    const tdCloses = document.createElement('td');
    tdCloses.className = 'font-mono';
    tdCloses.textContent = getMarketCloseTimeStr(order.symbol);

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
    tr.appendChild(tdVolume);
    tr.appendChild(tdOpeningPrice);
    tr.appendChild(tdCurrentPrice);
    tr.appendChild(tdTp);
    tr.appendChild(tdSl);
    tr.appendChild(tdOrder);
    tr.appendChild(tdOpenTime);
    tr.appendChild(tdCloses);
    tr.appendChild(tdAction);

    return tr;
  });

  tbody.replaceChildren(...rows);
}

function renderHistoryTable(history) {
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
    const lots = item.volume / getLotMultiplier(item.symbol);
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

  // Draw active alerts lines
  if (typeof activeAlerts !== 'undefined') {
    activeAlerts.forEach(alert => {
      if (alert.symbol !== currentMapped) return;

      const condSymbol = alert.condition === 'above' ? '≥' : '≤';
      const alertLine = candlestickSeries.createPriceLine({
        price: alert.price,
        color: '#bf5af2', // purple for alerts
        lineWidth: 1.5,
        lineStyle: 3, // dotted
        axisLabelVisible: true,
        title: `Alert ${condSymbol} ${alert.price}`
      });
      activeChartPriceLines.push(alertLine);
    });
  }
}

function showChartContextMenu(x, y, price) {
  const existingMenu = document.getElementById('chart-context-menu');
  if (existingMenu) existingMenu.remove();

  const keySymbol = getMappedSymbol();
  const coin = marketEngine.coins[keySymbol];
  const activeSymbolName = keySymbol.split('/')[0];

  // Get active open positions for this symbol
  const openPositions = tradingEngine.positions.filter(p => p.symbol === keySymbol);

  // Create menu container
  const menu = document.createElement('div');
  menu.id = 'chart-context-menu';
  menu.style.position = 'absolute';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.style.background = 'rgba(21, 26, 35, 0.96)';
  menu.style.border = '1px solid var(--border-color)';
  menu.style.borderRadius = '6px';
  menu.style.boxShadow = '0 8px 32px rgba(0,0,0,0.6)';
  menu.style.backdropFilter = 'blur(12px)';
  menu.style.zIndex = '1000';
  menu.style.padding = '6px';
  menu.style.width = '200px';
  menu.style.display = 'flex';
  menu.style.flexDirection = 'column';
  menu.style.gap = '2px';
  menu.style.fontFamily = "'Inter', sans-serif";

  // Price header
  const header = document.createElement('div');
  header.style.fontSize = '9px';
  header.style.color = 'var(--text-secondary)';
  header.style.padding = '4px 8px';
  header.style.borderBottom = '1px solid var(--border-color)';
  header.style.marginBottom = '4px';
  header.style.fontFamily = 'monospace';
  header.style.fontWeight = 'bold';
  header.textContent = `${price} ${activeSymbolName}`;
  menu.appendChild(header);

  // Helper function to create menu item
  const createMenuItem = (text, onClick, colorClass) => {
    const item = document.createElement('div');
    item.className = 'chart-menu-item';
    item.style.padding = '6px 8px';
    item.style.fontSize = '11px';
    item.style.color = '#fff';
    item.style.cursor = 'pointer';
    item.style.borderRadius = '4px';
    item.style.display = 'flex';
    item.style.alignItems = 'center';
    item.style.gap = '8px';
    item.style.transition = 'all 0.1s ease';

    // Dot indicator
    const dot = document.createElement('span');
    dot.style.display = 'inline-block';
    dot.style.width = '6px';
    dot.style.height = '6px';
    dot.style.borderRadius = '50%';
    if (colorClass === 'green') {
      dot.style.background = '#00c076';
    } else if (colorClass === 'red') {
      dot.style.background = '#e25241';
    } else if (colorClass === 'purple') {
      dot.style.background = '#bf5af2';
    } else {
      dot.style.background = 'var(--text-secondary)';
    }

    item.appendChild(dot);
    const label = document.createElement('span');
    label.textContent = text;
    item.appendChild(label);

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
      menu.remove();
    });

    item.onmouseenter = () => { item.style.backgroundColor = 'rgba(255,255,255,0.06)'; };
    item.onmouseleave = () => { item.style.backgroundColor = 'transparent'; };

    return item;
  };

  // 1. Action: Set TP for Order Form
  menu.appendChild(createMenuItem('Set TP for Pending Order', () => {
    const tpInput = document.getElementById('tp-price-input');
    if (tpInput) {
      tpInput.value = price;
      updateTempTpLine(price);
      updateOrderCalculations();
      showToast('success', 'Take Profit Set', `Order TP set to ${price}`);
    }
  }, 'green'));

  // 2. Action: Set SL for Order Form
  menu.appendChild(createMenuItem('Set SL for Pending Order', () => {
    const slInput = document.getElementById('sl-price-input');
    if (slInput) {
      slInput.value = price;
      updateTempSlLine(price);
      updateOrderCalculations();
      showToast('success', 'Stop Loss Set', `Order SL set to ${price}`);
    }
  }, 'red'));

  // 3. Action: Create Price Alert
  menu.appendChild(createMenuItem('Create Alert Here', () => {
    if (typeof activeAlerts !== 'undefined') {
      const currentPrice = coin ? coin.currentPrice : price;
      const condition = price >= currentPrice ? 'above' : 'below';
      const alertItem = {
        id: 'alt_' + Math.random().toString(36).substring(2, 11),
        symbol: keySymbol,
        condition: condition,
        price: price,
        createdAt: Date.now()
      };
      activeAlerts.push(alertItem);
      saveAlerts();
      updateChartPriceLines(tradingEngine.positions, tradingEngine.pendingOrders);
      const alertsList = document.getElementById('active-alerts-list');
      if (alertsList && typeof renderAlertsList === 'function') {
        renderAlertsList();
      }
      showToast('success', 'Alert Created', `Alert set for ${activeSymbolName} ${condition} ${price}`);
    }
  }, 'purple'));

  // 4. Action: Update Open Positions TP/SL
  if (openPositions.length > 0) {
    const separator = document.createElement('div');
    separator.style.height = '1px';
    separator.style.background = 'var(--border-color)';
    separator.style.margin = '4px 0';
    menu.appendChild(separator);

    const posHeader = document.createElement('div');
    posHeader.style.fontSize = '8px';
    posHeader.style.color = '#8a99ad';
    posHeader.style.padding = '2px 8px';
    posHeader.style.fontWeight = 'bold';
    posHeader.textContent = 'OPEN POSITIONS';
    menu.appendChild(posHeader);

    openPositions.forEach(pos => {
      const posLots = pos.volume / getLotMultiplier();
      const posLabel = `${pos.type} ${posLots.toFixed(2)} Lot`;

      menu.appendChild(createMenuItem(`Set TP for ${posLabel}`, () => {
        tradingEngine.modifyPositionSLTP(pos.id, undefined, price);
        showToast('success', 'Position TP Set', `Position TP updated to ${price}`);
      }, 'green'));

      menu.appendChild(createMenuItem(`Set SL for ${posLabel}`, () => {
        tradingEngine.modifyPositionSLTP(pos.id, price, undefined);
        showToast('success', 'Position SL Set', `Position SL updated to ${price}`);
      }, 'red'));
    });
  }

  // Append to chart-wrapper
  const chartWrapper = document.querySelector('.chart-wrapper');
  if (chartWrapper) {
    chartWrapper.appendChild(menu);
  }

  // Dismiss menu on click anywhere
  const dismissMenu = () => {
    menu.remove();
    document.removeEventListener('click', dismissMenu);
  };
  setTimeout(() => {
    document.addEventListener('click', dismissMenu);
  }, 10);
}

function updateTempTpLine(price) {
  if (!candlestickSeries) return;
  if (tempTpLine) {
    try {
      candlestickSeries.removePriceLine(tempTpLine);
    } catch (e) { }
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
    } catch (e) { }
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
    } catch (e) { }
    tempTpLine = null;
  }
  if (tempSlLine) {
    try {
      candlestickSeries.removePriceLine(tempSlLine);
    } catch (e) { }
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

  setDrawingTool = (tool, activeBtn) => {
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
      try {
        localStorage.setItem('bitstar_chart_layout', JSON.stringify(layout));
        showToast('success', 'Layout Saved', 'Indicators, drawing lines, and layout preferences successfully saved.');
      } catch (err) {
        console.error("Failed to write layout to localStorage:", err);
        showToast('error', 'Save Failed', 'Storage is disabled or unavailable.');
      }
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
  let saved = null;
  try {
    saved = localStorage.getItem('bitstar_chart_layout');
  } catch (err) {
    console.warn("Failed to load layout from localStorage:", err);
  }
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
const currentUser = { username: 'Real User', role: 'USER', balance: 10000.00 };
const activeBalanceSource = 'real';
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

    // Build instrument item DOM safely (avoid innerHTML XSS with user-provided coin.icon)
    const leftDiv = document.createElement('div');
    leftDiv.className = 'instrument-left';
    const iconDiv = document.createElement('div');
    iconDiv.className = 'instrument-icon';
    iconDiv.style.color = iconColor;
    iconDiv.textContent = coin.icon || '?';
    const metaDiv = document.createElement('div');
    metaDiv.className = 'instrument-meta';
    const symbolDiv = document.createElement('div');
    symbolDiv.className = 'instrument-symbol';
    symbolDiv.textContent = friendlyName;
    const badgeDiv = document.createElement('div');
    badgeDiv.className = `instrument-badge ${category}`;
    badgeDiv.textContent = badgeText;
    metaDiv.appendChild(symbolDiv);
    metaDiv.appendChild(badgeDiv);
    leftDiv.appendChild(iconDiv);
    leftDiv.appendChild(metaDiv);

    const rightDiv = document.createElement('div');
    rightDiv.className = 'instrument-right';
    const priceDiv = document.createElement('div');
    priceDiv.className = 'instrument-price font-mono';
    priceDiv.textContent = currentPrice.toFixed(dec);
    const changeDiv = document.createElement('div');
    changeDiv.className = `instrument-change font-mono ${isUp ? 'up' : 'down'}`;
    changeDiv.textContent = `${isUp ? '+' : ''}${changePct.toFixed(2)}%`;
    rightDiv.appendChild(priceDiv);
    rightDiv.appendChild(changeDiv);

    item.appendChild(leftDiv);
    item.appendChild(rightDiv);

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

// Initialize Closed History CSV/Excel Exporter
function initHistoryExporter() {
  const exportBtn = document.getElementById('export-history-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const history = tradingEngine.history;
      if (!history || history.length === 0) {
        showToast('info', 'No History', 'There are no closed trades to export.');
        return;
      }

      let csvContent = 'Symbol,Type,Volume (Lot),Open Price,Close Price,Take Profit,Stop Loss,Open Time,Close Time,Swap (USD),Reason,Profit/Loss (USD)\r\n';
      const lotMultiplier = getLotMultiplier();

      history.forEach(trade => {
        const symbol = trade.symbol.replace('/', '');
        const type = trade.type;
        const tradeLotMultiplier = getLotMultiplier(trade.symbol);
        const volume = (trade.volume / tradeLotMultiplier).toFixed(2);
        // Use entryPrice/exitPrice (correct field names from tradingEngine history objects)
        const openPrice = (trade.entryPrice || trade.openPrice || 0).toFixed(5);
        const closePrice = (trade.exitPrice || trade.closePrice || 0).toFixed(5);
        const tp = trade.tp ? trade.tp.toFixed(5) : '-';
        const sl = trade.sl ? trade.sl.toFixed(5) : '-';
        const openTime = formatBitstarDateTime(trade.openTime);
        const closeTime = formatBitstarDateTime(trade.closeTime);
        const swap = trade.swap ? trade.swap.toFixed(2) : '0.00';
        const reason = trade.exitReason || 'Closed';
        const pnl = (trade.pnl || 0).toFixed(2);

        const row = `"${symbol}","${type}",${volume},${openPrice},${closePrice},"${tp}","${sl}","${openTime}","${closeTime}",${swap},"${reason}",${pnl}`;
        csvContent += row + '\r\n';
      });

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `bitstar_trading_history_${Date.now()}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('success', 'History Exported', 'CSV report downloaded successfully.');
    });
  }
}

function openModifyPositionModal(pos) {
  // Remove existing modal if any
  const existing = document.getElementById('advanced-modify-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'advanced-modify-modal-overlay';

  const getLotMultiplierForSymbol = (symbol) => {
    if (!symbol) return 1.0;
    if (symbol.startsWith('BTC')) return 1.0;     // 1 BTC per lot
    if (symbol.startsWith('ETH')) return 10.0;    // 10 ETH per lot
    if (symbol.startsWith('EUR')) return 100000.0; // 100,000 EUR per lot
    if (symbol.startsWith('XAU') || symbol.startsWith('GC')) return 100.0;    // 100 oz of Gold per lot
    if (symbol.startsWith('XAG') || symbol.startsWith('SI')) return 5000.0;   // 5,000 oz of Silver per lot
    return 1000.0; // USOIL: 1,000 barrels per lot
  };

  const lotMultiplier = getLotMultiplierForSymbol(pos.symbol);
  const currentLots = pos.volume / lotMultiplier;
  const keySymbol = pos.symbol;
  const coin = marketEngine.coins[keySymbol];
  const dec = coin ? coin.decimalPlaces : 2;

  // Modal Outer Box
  const modal = document.createElement('div');
  modal.className = 'modify-modal';

  // Modal Header
  const header = document.createElement('div');
  header.className = 'modal-header';
  const headerTitle = document.createElement('h3');
  headerTitle.textContent = `Modify Position #${pos.id.replace('ord_', '')}`;
  const headerClose = document.createElement('span');
  headerClose.className = 'modal-close';
  headerClose.textContent = '×';
  headerClose.addEventListener('click', () => dismissModal());
  header.appendChild(headerTitle);
  header.appendChild(headerClose);
  modal.appendChild(header);

  // Modal Tabs
  const tabs = document.createElement('div');
  tabs.className = 'modal-tabs';

  const tabBtnParams = document.createElement('button');
  tabBtnParams.className = 'modal-tab-btn active';
  tabBtnParams.textContent = 'Modify Setup';

  const tabBtnPartial = document.createElement('button');
  tabBtnPartial.className = 'modal-tab-btn';
  tabBtnPartial.textContent = 'Partial Close';

  tabs.appendChild(tabBtnParams);
  tabs.appendChild(tabBtnPartial);
  modal.appendChild(tabs);

  // Modal Content Bodies
  const bodyParams = document.createElement('div');
  bodyParams.className = 'modal-body';

  const bodyPartial = document.createElement('div');
  bodyPartial.className = 'modal-body hidden';

  modal.appendChild(bodyParams);
  modal.appendChild(bodyPartial);

  // --- 1. POPULATE DETAILS PANEL ---
  const detailsPanel = document.createElement('div');
  detailsPanel.className = 'modal-info-panel';

  const addInfoItem = (parent, label, value, id) => {
    const item = document.createElement('div');
    item.className = 'modal-info-item';
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = value;
    if (id) val.id = id;
    item.appendChild(lbl);
    item.appendChild(val);
    parent.appendChild(item);
  };

  addInfoItem(detailsPanel, 'Symbol', pos.symbol.replace('/', ''));
  addInfoItem(detailsPanel, 'Type', pos.type, null);
  addInfoItem(detailsPanel, 'Lots', currentLots.toFixed(2), null);
  addInfoItem(detailsPanel, 'P&L (USD)', `$${pos.pnl.toFixed(2)}`, 'modal-pnl-val');

  bodyParams.appendChild(detailsPanel.cloneNode(true));
  bodyPartial.appendChild(detailsPanel);

  // --- 2. POPULATE SETUP BODY ---
  const createInputGroup = (parent, label, placeholder, value, suffix) => {
    const group = document.createElement('div');
    group.className = 'modal-input-group';
    const title = document.createElement('span');
    title.className = 'modal-section-title';
    title.textContent = label;
    group.appendChild(title);

    const wrapper = document.createElement('div');
    wrapper.className = 'modal-input-wrapper';

    const input = document.createElement('input');
    input.type = 'number';
    input.placeholder = placeholder;
    input.step = 'any';
    if (value) input.value = value;

    wrapper.appendChild(input);
    if (suffix) {
      const suf = document.createElement('span');
      suf.className = 'suffix';
      suf.textContent = suffix;
      wrapper.appendChild(suf);
    }
    group.appendChild(wrapper);
    parent.appendChild(group);
    return input;
  };

  const slInput = createInputGroup(bodyParams, 'Stop Loss (SL)', 'Not set', pos.sl || '', 'Price');
  const tpInput = createInputGroup(bodyParams, 'Take Profit (TP)', 'Not set', pos.tp || '', 'Price');
  const tslInput = createInputGroup(bodyParams, 'Trailing Stop (TSL)', 'Not set', pos.tsl || '', 'Pips');

  // Multi-TP targets UI
  const multiTpGroup = document.createElement('div');
  multiTpGroup.className = 'modal-input-group';
  const multiTpTitle = document.createElement('span');
  multiTpTitle.className = 'modal-section-title';
  multiTpTitle.textContent = 'Multiple TP Targets';
  multiTpGroup.appendChild(multiTpTitle);

  const tpTargetsContainer = document.createElement('div');
  tpTargetsContainer.style.display = 'flex';
  tpTargetsContainer.style.flexDirection = 'column';
  tpTargetsContainer.style.gap = '6px';

  // Load existing targets
  const targets = pos.tpTargets || [];
  const tp1Val = targets[0] ? targets[0].price : '';
  const tp1Pct = targets[0] ? targets[0].pct : 50;
  const tp2Val = targets[1] ? targets[1].price : '';
  const tp2Pct = targets[1] ? targets[1].pct : 50;

  const createTpTargetRow = (parent, index, defaultPrice, defaultPct) => {
    const row = document.createElement('div');
    row.className = 'modal-multi-tp-row';

    const wrapperPrice = document.createElement('div');
    wrapperPrice.className = 'modal-input-wrapper';
    const inputPrice = document.createElement('input');
    inputPrice.type = 'number';
    inputPrice.placeholder = `TP${index} Price`;
    inputPrice.step = 'any';
    if (defaultPrice) inputPrice.value = defaultPrice;
    wrapperPrice.appendChild(inputPrice);

    const wrapperPct = document.createElement('div');
    wrapperPct.className = 'modal-input-wrapper';
    const inputPct = document.createElement('input');
    inputPct.type = 'number';
    inputPct.placeholder = 'Close %';
    inputPct.min = '10';
    inputPct.max = '100';
    inputPct.value = defaultPct;
    wrapperPct.appendChild(inputPct);
    const suffix = document.createElement('span');
    suffix.className = 'suffix';
    suffix.textContent = '%';
    wrapperPct.appendChild(suffix);

    row.appendChild(wrapperPrice);
    row.appendChild(wrapperPct);
    parent.appendChild(row);
    return { inputPrice, inputPct };
  };

  const tp1 = createTpTargetRow(tpTargetsContainer, 1, tp1Val, tp1Pct);
  const tp2 = createTpTargetRow(tpTargetsContainer, 2, tp2Val, tp2Pct);

  multiTpGroup.appendChild(tpTargetsContainer);
  bodyParams.appendChild(multiTpGroup);

  // --- 3. POPULATE PARTIAL CLOSE BODY ---
  const partialCloseGroup = document.createElement('div');
  partialCloseGroup.className = 'modal-input-group';
  const partialCloseTitle = document.createElement('span');
  partialCloseTitle.className = 'modal-section-title';
  partialCloseTitle.textContent = 'Lots to Close';
  partialCloseGroup.appendChild(partialCloseTitle);

  const sliderWrapper = document.createElement('div');
  sliderWrapper.className = 'modal-slider-wrapper';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'modal-slider';
  slider.min = '0.01';
  slider.max = currentLots.toFixed(2);
  slider.step = '0.01';
  slider.value = (currentLots / 2).toFixed(2);

  const partialValInput = document.createElement('input');
  partialValInput.type = 'number';
  partialValInput.style.width = '64px';
  partialValInput.style.background = 'var(--bg-tertiary)';
  partialValInput.style.border = '1px solid var(--border-color)';
  partialValInput.style.color = '#fff';
  partialValInput.style.padding = '4px 8px';
  partialValInput.style.borderRadius = '4px';
  partialValInput.style.fontFamily = 'monospace';
  partialValInput.style.fontSize = '11px';
  partialValInput.value = (currentLots / 2).toFixed(2);

  slider.addEventListener('input', (e) => {
    partialValInput.value = parseFloat(e.target.value).toFixed(2);
    updatePartialClosePnl();
  });
  partialValInput.addEventListener('input', (e) => {
    slider.value = parseFloat(e.target.value) || 0.01;
    updatePartialClosePnl();
  });

  sliderWrapper.appendChild(slider);
  sliderWrapper.appendChild(partialValInput);
  partialCloseGroup.appendChild(sliderWrapper);

  const partialClosePnlRow = document.createElement('div');
  partialClosePnlRow.style.fontSize = '10.5px';
  partialClosePnlRow.style.color = 'var(--text-secondary)';
  partialClosePnlRow.style.marginTop = '12px';
  partialClosePnlRow.style.display = 'flex';
  partialClosePnlRow.style.justifyContent = 'space-between';
  const pnlLabel = document.createElement('span');
  pnlLabel.textContent = 'Estimated Close P&L:';
  const pnlVal = document.createElement('span');
  pnlVal.style.fontWeight = '700';
  pnlVal.style.fontFamily = 'monospace';
  pnlVal.id = 'modal-partial-pnl-val';
  partialClosePnlRow.appendChild(pnlLabel);
  partialClosePnlRow.appendChild(pnlVal);
  partialCloseGroup.appendChild(partialClosePnlRow);

  bodyPartial.appendChild(partialCloseGroup);

  function updatePartialClosePnl() {
    const closeLots = parseFloat(partialValInput.value) || 0.01;
    const ratio = Math.min(1.0, closeLots / currentLots);
    const estimatedPnl = pos.pnl * ratio;
    const valEl = document.getElementById('modal-partial-pnl-val');
    if (valEl) {
      const isProf = estimatedPnl >= 0;
      valEl.textContent = `${isProf ? '+' : ''}$${estimatedPnl.toFixed(2)} USD`;
      valEl.style.color = isProf ? 'var(--color-buy)' : 'var(--color-sell)';
    }
  }

  // --- 4. MODAL FOOTER ---
  const footer = document.createElement('div');
  footer.className = 'modal-footer';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'modal-btn cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => dismissModal());

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'modal-btn confirm';
  confirmBtn.textContent = 'Confirm Modification';

  footer.appendChild(cancelBtn);
  footer.appendChild(confirmBtn);
  modal.appendChild(footer);

  // Tab switching logic
  tabBtnParams.addEventListener('click', () => {
    tabBtnParams.className = 'modal-tab-btn active';
    tabBtnPartial.className = 'modal-tab-btn';
    bodyParams.classList.remove('hidden');
    bodyPartial.classList.add('hidden');
    confirmBtn.textContent = 'Confirm Modification';
  });

  tabBtnPartial.addEventListener('click', () => {
    tabBtnPartial.className = 'modal-tab-btn active';
    tabBtnParams.className = 'modal-tab-btn';
    bodyPartial.classList.remove('hidden');
    bodyParams.classList.add('hidden');
    confirmBtn.textContent = 'Execute Partial Close';
    updatePartialClosePnl();
  });

  // Action Submission logic
  confirmBtn.addEventListener('click', () => {
    if (!bodyParams.classList.contains('hidden')) {
      // Modify configuration
      const sl = parseFloat(slInput.value) || null;
      const tp = parseFloat(tpInput.value) || null;
      const tsl = parseFloat(tslInput.value) || null;

      // Extract Multi-TP targets
      const tpTargets = [];
      const t1Price = parseFloat(tp1.inputPrice.value);
      const t1Pct = parseFloat(tp1.inputPct.value) || 50;
      if (t1Price && t1Price > 0) {
        tpTargets.push({ price: t1Price, pct: t1Pct, triggered: false });
      }
      const t2Price = parseFloat(tp2.inputPrice.value);
      const t2Pct = parseFloat(tp2.inputPct.value) || 50;
      if (t2Price && t2Price > 0) {
        tpTargets.push({ price: t2Price, pct: t2Pct, triggered: false });
      }

      tradingEngine.modifyPositionAdvanced(pos.id, { sl, tp, tsl, tpTargets });
    } else {
      // Execute Partial Close
      const closeLots = parseFloat(partialValInput.value) || 0.01;
      const closeVolume = closeLots * lotMultiplier;
      tradingEngine.partialClosePosition(pos.id, closeVolume);
    }
    dismissModal();
  });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Trigger fade in animation
  setTimeout(() => {
    overlay.classList.add('show');
  }, 10);

  function dismissModal() {
    overlay.classList.remove('show');
    setTimeout(() => {
      overlay.remove();
    }, 250);
  }
}

function initGoogleAuth() {
  const loginBtnContainer = document.getElementById('google-login-btn-container');
  const loggedInProfile = document.getElementById('user-logged-in-profile');
  const profilePic = document.getElementById('user-profile-pic');
  const profileName = document.getElementById('user-profile-name');
  const profileEmail = document.getElementById('user-profile-email');
  const profileDropdown = document.getElementById('profile-dropdown');
  const signOutBtn = document.getElementById('sign-out-btn');

  const googleClientId = '190383912136-u78g0vl8jdd1lavpbo693gspiii3sfq9.apps.googleusercontent.com';

  // Profile dropdown toggle
  if (loggedInProfile && profileDropdown) {
    loggedInProfile.addEventListener('click', (e) => {
      e.stopPropagation();
      profileDropdown.classList.toggle('hidden');
    });
    document.addEventListener('click', () => {
      if (profileDropdown) profileDropdown.classList.add('hidden');
    });
  }

    // Handle Login UI elements update
  function updateLoginUI(email, name, picture) {
    if (loginBtnContainer) loginBtnContainer.classList.add('hidden');
    if (loggedInProfile) loggedInProfile.classList.remove('hidden');
    
    const depositBtn = document.getElementById('deposit-crypto-btn');
    const withdrawBtn = document.getElementById('withdraw-crypto-btn');
    if (depositBtn) depositBtn.classList.remove('hidden');
    if (withdrawBtn) withdrawBtn.classList.remove('hidden');

    // Only set src if picture is a valid non-empty string (avoid 404 from null/undefined)
    if (profilePic && picture && typeof picture === 'string' && picture.length > 0) {
      profilePic.src = picture;
    }
    if (profileName) profileName.textContent = name || '';
    if (profileEmail) profileEmail.textContent = email || '';

    if (window.checkAdminStatus) {
      window.checkAdminStatus();
    }

    showRightWorkspace();
  }

  // Handle Login flow
  async function performLogin(type, payload) {
    try {
      const endpoint = '/api/auth/google';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Authentication failed');
      }

      const user = await response.json();

      // Update local storage user session
      localStorage.setItem('user_session', JSON.stringify({
        email: user.email,
        name: user.name,
        picture: user.picture
      }));

      // Update trading engine and load state
      tradingEngine.accountId = user.accountId;
      tradingEngine.isGuest = false;
      tradingEngine.loadStateFromServer();

      updateLoginUI(user.email, user.name, user.picture);
      showToast('success', 'Logged In', `Welcome back, ${user.name}!`);
    } catch (err) {
      console.error('Authentication flow failed:', err);
      showToast('error', 'Login Failed', err.message);
    }
  }

  // Sign Out handler
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
        localStorage.removeItem('user_session');
        if (profileDropdown) profileDropdown.classList.add('hidden');
        if (loginBtnContainer) loginBtnContainer.classList.remove('hidden');
        if (loggedInProfile) loggedInProfile.classList.add('hidden');
        
        const depositBtn = document.getElementById('deposit-crypto-btn');
        const withdrawBtn = document.getElementById('withdraw-crypto-btn');
        const adminBtn = document.getElementById('admin-panel-btn');
        if (depositBtn) depositBtn.classList.add('hidden');
        if (withdrawBtn) withdrawBtn.classList.add('hidden');
        if (adminBtn) adminBtn.classList.add('hidden');

        // Clear all in-memory trading state immediately (prevent old data flash)
        tradingEngine.positions = [];
        tradingEngine.pendingOrders = [];
        tradingEngine.history = [];
        tradingEngine.balance = 0;
        tradingEngine.isLoaded = false;
        tradingEngine.recalculateStats({});
        tradingEngine.notify();

        // Reset trading engine to default guest state
        tradingEngine.accountId = tradingEngine.generateAccountId();
        tradingEngine.isGuest = true;

        // Re-authenticate guest session
        await initializeSession();
      } catch (err) {
        console.error('Logout failed:', err);
        showToast('error', 'Logout Error', 'Failed to log out correctly.');
      }
    });
  }

  // Check and initialize session on startup
  async function initializeSession() {
    try {
      const res = await fetch('/api/auth/session');
      if (res.ok) {
        const session = await res.json();
        tradingEngine.accountId = session.accountId;
        tradingEngine.isGuest = false;
        tradingEngine.loadStateFromServer();

        updateLoginUI(session.email, session.name, session.picture);
      } else {
        // No valid session cookie - unauthenticated state
        tradingEngine.accountId = null;
        tradingEngine.isGuest = true;
        
        if (loginBtnContainer) loginBtnContainer.classList.remove('hidden');
        if (loggedInProfile) loggedInProfile.classList.add('hidden');
        hideRightWorkspace();
      }
    } catch (err) {
      console.error('Session initialization failed:', err);
      tradingEngine.accountId = null;
      tradingEngine.isGuest = true;
      
      if (loginBtnContainer) loginBtnContainer.classList.remove('hidden');
      if (loggedInProfile) loggedInProfile.classList.add('hidden');
      hideRightWorkspace();
    }
  }

  // Trigger startup session loading
  initializeSession();

  tradingEngine.onAuthFailure = () => {
    console.warn("Authorization failure detected. Re-initializing session...");
    initializeSession();
  };

  // Initialize and Render Google Identity Services standard button & One Tap natively
  function startGIS() {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
      google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response) => {
          performLogin('google', { credential: response.credential });
        }
      });

      if (loginBtnContainer) {
        google.accounts.id.renderButton(loginBtnContainer, {
          theme: 'dark',
          size: 'medium',
          type: 'standard',
          shape: 'rectangular',
          text: 'signin',
          logo_alignment: 'left'
        });
      }

      // Only show One Tap if we are currently a guest
      if (tradingEngine.isGuest) {
        google.accounts.id.prompt();
      }
    }
  }

  function initWeb3Deposit() {
    const depositBtn = document.getElementById('deposit-crypto-btn');
    const modalOverlay = document.getElementById('deposit-modal-overlay');
    const closeBtn = document.getElementById('close-deposit-modal');
    const cancelBtn = document.getElementById('cancel-deposit-btn');
    const connectBtn = document.getElementById('connect-wallet-btn');
    const submitBtn = document.getElementById('submit-deposit-btn');
    const walletDisplay = document.getElementById('wallet-address-display');
    const amountInput = document.getElementById('deposit-amount-input');
    const statusMsg = document.getElementById('deposit-status-msg');
    
    let userSigner = null;

    depositBtn.addEventListener('click', () => {
      if (tradingEngine.isGuest) {
        showToast('error', 'Login Required', 'You must sign in to deposit funds.');
        return;
      }
      modalOverlay.classList.add('show');
    });

    const closeModal = () => {
      modalOverlay.classList.remove('show');
      statusMsg.classList.add('hidden');
      amountInput.value = '';
    };

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);

    connectBtn.addEventListener('click', async () => {
      if (typeof window.ethereum === 'undefined') {
        statusMsg.textContent = "MetaMask not detected. Please install a Web3 wallet.";
        statusMsg.style.color = "#ff4d4d";
        statusMsg.classList.remove('hidden');
        return;
      }
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        const network = await provider.getNetwork();
        
        // Ensure user is on Polygon Mainnet (chainId 137)
        if (network.chainId !== 137n) {
          try {
            await window.ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: '0x89' }], // 137 in hex
            });
          } catch (switchError) {
            statusMsg.textContent = "Please switch your wallet to Polygon Mainnet.";
            statusMsg.style.color = "#ff4d4d";
            statusMsg.classList.remove('hidden');
            return;
          }
        }
        
        userSigner = await provider.getSigner();
        const address = await userSigner.getAddress();
        
        connectBtn.classList.add('hidden');
        walletDisplay.textContent = "Connected: " + address.substring(0,6) + "..." + address.substring(address.length - 4);
        walletDisplay.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        submitBtn.style.cursor = 'pointer';
        
      } catch (err) {
        statusMsg.textContent = "Failed to connect wallet: " + err.message;
        statusMsg.style.color = "#ff4d4d";
        statusMsg.classList.remove('hidden');
      }
    });

    submitBtn.addEventListener('click', async () => {
      if (!userSigner) return;
      const amount = amountInput.value;
      if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
        statusMsg.textContent = "Please enter a valid amount.";
        statusMsg.style.color = "#ff4d4d";
        statusMsg.classList.remove('hidden');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Processing...";
      statusMsg.textContent = "Please approve the transaction in your wallet...";
      statusMsg.style.color = "var(--text-secondary)";
      statusMsg.classList.remove('hidden');

      try {
        // Warning: This admin address is meant to be fetched from backend or hardcoded here securely
        // In this implementation, the backend does the true check against process.env.RECEIVING_WALLET_ADDRESS
        // The frontend needs to know where to send it. We'll fetch it from an API or just use a placeholder
        // For security, it's best to fetch it.
        const adminWalletRes = await fetch('/api/wallet/address');
        if (!adminWalletRes.ok) throw new Error("Could not fetch receiving address.");
        const { address: adminAddress } = await adminWalletRes.json();

        const tx = await userSigner.sendTransaction({
          to: adminAddress,
          value: ethers.parseEther(amount.toString())
        });

        statusMsg.textContent = "Waiting for network confirmation...";
        const receipt = await tx.wait();

        if (receipt.status === 1) {
          statusMsg.textContent = "Transaction confirmed! Verifying with backend...";
          const verifyRes = await fetch('/api/wallet/deposit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ txHash: tx.hash })
          });
          const verifyData = await verifyRes.json();

          if (verifyRes.ok) {
            statusMsg.textContent = `Success! Credited ${verifyData.amountUsd.toFixed(2)} USD.`;
            statusMsg.style.color = "#00c076";
            tradingEngine.balance += verifyData.amountUsd;
            updateBalanceUI();
            setTimeout(closeModal, 3000);
          } else {
            throw new Error(verifyData.error || "Backend verification failed.");
          }
        } else {
          throw new Error("Transaction failed on the network.");
        }
      } catch (err) {
        statusMsg.textContent = err.message.substring(0, 50) + (err.message.length > 50 ? "..." : "");
        statusMsg.style.color = "#ff4d4d";
        submitBtn.disabled = false;
        submitBtn.textContent = "Send Deposit";
      }
    });
  }

  function initWeb3Withdraw() {
    const withdrawBtn = document.getElementById('withdraw-crypto-btn');
    const modalOverlay = document.getElementById('withdraw-modal-overlay');
    const closeBtn = document.getElementById('close-withdraw-modal');
    const cancelBtn = document.getElementById('cancel-withdraw-btn');
    const submitBtn = document.getElementById('submit-withdraw-btn');
    const addressInput = document.getElementById('withdraw-address-input');
    const amountInput = document.getElementById('withdraw-amount-input');
    const statusMsg = document.getElementById('withdraw-status-msg');

    withdrawBtn.addEventListener('click', () => {
      if (tradingEngine.isGuest) {
        showToast('error', 'Login Required', 'You must sign in to withdraw funds.');
        return;
      }
      modalOverlay.classList.add('show');
    });

    const closeModal = () => {
      modalOverlay.classList.remove('show');
      statusMsg.classList.add('hidden');
      addressInput.value = '';
      amountInput.value = '';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Request Withdraw';
    };

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);

    submitBtn.addEventListener('click', async () => {
      const address = addressInput.value.trim();
      const amount = parseFloat(amountInput.value);
      
      if (!address || !address.startsWith('0x') || address.length !== 42) {
        statusMsg.textContent = "Please enter a valid Polygon address.";
        statusMsg.style.color = "#ff4d4d";
        statusMsg.classList.remove('hidden');
        return;
      }
      
      if (!amount || isNaN(amount) || amount <= 0 || amount > tradingEngine.balance) {
        statusMsg.textContent = "Invalid amount or insufficient balance.";
        statusMsg.style.color = "#ff4d4d";
        statusMsg.classList.remove('hidden');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Processing...";
      statusMsg.textContent = "Submitting withdrawal request...";
      statusMsg.style.color = "var(--text-secondary)";
      statusMsg.classList.remove('hidden');

      try {
        const res = await fetch('/api/wallet/withdraw', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ walletAddress: address, amountUsd: amount })
        });
        
        const data = await res.json();
        if (res.ok) {
          statusMsg.textContent = "Withdrawal request submitted successfully!";
          statusMsg.style.color = "#00c076";
          tradingEngine.balance -= amount;
          updateBalanceUI();
          setTimeout(closeModal, 2500);
        } else {
          throw new Error(data.error || "Failed to submit request.");
        }
      } catch (err) {
        statusMsg.textContent = err.message;
        statusMsg.style.color = "#ff4d4d";
        submitBtn.disabled = false;
        submitBtn.textContent = "Request Withdraw";
      }
    });
  }

  function initAdminPanel() {
    const adminBtn = document.getElementById('admin-panel-btn');
    const modalOverlay = document.getElementById('admin-modal-overlay');
    const closeBtn = document.getElementById('close-admin-modal');
    const listContainer = document.getElementById('admin-withdrawals-list');
    
    // We will unhide the button during successful login if the backend confirms admin
    // For simplicity, we can fetch stats. If it fails (403), they aren't admin.
    // If it succeeds, they are admin and we show the button.
    
    // Expose a global or hook into login to check admin status
    window.checkAdminStatus = async () => {
      try {
        const res = await fetch('/api/admin/stats');
        if (res.ok) {
          adminBtn.classList.remove('hidden');
        }
      } catch(e) {}
    };

    adminBtn.addEventListener('click', async () => {
      modalOverlay.classList.add('show');
      await refreshAdminStats();
    });
    
    closeBtn.addEventListener('click', () => {
      modalOverlay.classList.remove('show');
    });

    async function refreshAdminStats() {
      try {
        listContainer.innerHTML = 'Loading...';
        const res = await fetch('/api/admin/stats');
        if (!res.ok) throw new Error('Not authorized');
        
        const data = await res.json();
        document.getElementById('admin-total-users').textContent = data.totalUsers;
        document.getElementById('admin-total-balance').textContent = '$' + data.totalBalance.toFixed(2);
        document.getElementById('admin-total-deposits').textContent = data.totalDeposits;
        document.getElementById('admin-total-in').textContent = '$' + data.totalDepositAmount.toFixed(2);
        
        listContainer.innerHTML = '';
        if (data.withdrawals.length === 0) {
          listContainer.innerHTML = '<div style="padding: 8px; text-align: center;">No withdrawal requests found.</div>';
          return;
        }

        data.withdrawals.forEach(w => {
          const div = document.createElement('div');
          div.style.background = 'var(--bg-tertiary)';
          div.style.padding = '8px';
          div.style.borderRadius = '4px';
          div.style.display = 'flex';
          div.style.justifyContent = 'space-between';
          div.style.alignItems = 'center';
          div.style.border = '1px solid var(--border-color)';
          
          let statusColor = w.status === 'pending' ? '#ff9f0a' : (w.status === 'approved' ? '#00c076' : '#ff4d4d');
          
          let actionButtons = '';
          if (w.status === 'pending') {
            actionButtons = `
              <div style="display: flex; gap: 4px;">
                <button class="admin-approve-btn" data-id="${w.id}" style="background: rgba(0, 192, 118, 0.2); border: 1px solid #00c076; color: #00c076; padding: 2px 6px; border-radius: 3px; font-size: 9px; cursor: pointer;">Approve</button>
                <button class="admin-reject-btn" data-id="${w.id}" style="background: rgba(255, 77, 77, 0.2); border: 1px solid #ff4d4d; color: #ff4d4d; padding: 2px 6px; border-radius: 3px; font-size: 9px; cursor: pointer;">Reject</button>
              </div>
            `;
          }

          div.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span style="font-weight: 700; color: #fff;">$${parseFloat(w.amount_usd).toFixed(2)} USD</span>
              <span style="font-family: var(--font-mono); font-size: 8px; color: var(--text-muted);">${w.wallet_address}</span>
            </div>
            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
              <span style="color: ${statusColor}; font-weight: 600; text-transform: uppercase; font-size: 8px;">${w.status}</span>
              ${actionButtons}
            </div>
          `;
          listContainer.appendChild(div);
        });

        // Attach event listeners
        document.querySelectorAll('.admin-approve-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const id = e.target.dataset.id;
            if (confirm('Did you manually send the crypto? This will mark it as approved.')) {
              await fetch(`/api/admin/withdrawals/${id}/approve`, { method: 'POST' });
              refreshAdminStats();
            }
          });
        });
        
        document.querySelectorAll('.admin-reject-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const id = e.target.dataset.id;
            if (confirm('Are you sure you want to reject this and refund the user?')) {
              await fetch(`/api/admin/withdrawals/${id}/reject`, { method: 'POST' });
              refreshAdminStats();
            }
          });
        });

      } catch (err) {
        listContainer.innerHTML = '<div style="color: #ff4d4d; padding: 8px;">Failed to load stats</div>';
      }
    }
  }

  function tryStartGIS() {
    if (typeof google === 'undefined') {
      const interval = setInterval(() => {
        if (typeof google !== 'undefined') {
          clearInterval(interval);
          startGIS();
        }
      }, 100);
      setTimeout(() => clearInterval(interval), 10000);
    } else {
      startGIS();
    }
  }

  // Delay GIS until session init finishes so we know if user is a guest or not
  setTimeout(tryStartGIS, 1500);

}; // End DOMContentLoaded or main wrapper

