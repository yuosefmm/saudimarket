const firebaseConfig = {
    apiKey: "AIzaSyASIYtMpcUsEF0K2HJ5GSYMjuzgGuHwEHg",
    authDomain: "saudimarkety.firebaseapp.com",
    projectId: "saudimarkety",
    storageBucket: "saudimarkety.firebasestorage.app",
    messagingSenderId: "840509227192",
    appId: "1:840509227192:web:36935a0411b8647816744d",
    measurementId: "G-6WZ1L6P61E"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Helper: Toast
window.showToast = (msg) => {
    const t = document.createElement('div');
    t.className = 'toast-msg';
    t.innerText = msg;
    document.body.appendChild(t);
    setTimeout(() => {
        t.style.opacity = '0';
        setTimeout(() => t.remove(), 500);
    }, 2000);
};

// Global DB Reference
let db;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        db = firebase.firestore();
        console.log('Firebase initialized successfully');

        // Real-time listener for stocks
        let allStocks = []; // Store for filtering

        db.collection('stocks').onSnapshot(async (snapshot) => {
            if (snapshot.empty) {
                console.log('No documents found.');
                // await seedInitialData(db); // REMOVED TO PREVENT FAKE DATA
                return;
            }

            const stocks = [];
            let tasiData = null;

            snapshot.forEach(doc => {
                const data = doc.data();
                if (doc.id === 'TASI') {
                    tasiData = data;
                } else {
                    stocks.push(data);
                }
            });

            // Ensure TASI is at the top
            if (tasiData && tasiData.price > 0) {
                updateTasiDisplay(tasiData);
                stocks.unshift(tasiData);
            } else {
                // If TASI doc missing OR price invalid (0), use Dummy/Previous Close for display
                // This ensures the header is never empty "---" if we have partial data
                const fallbackTasi = tasiData || { symbol: 'TASI', name: 'المؤشر العام', price: 12450.20, change: 0, percent: 0, year_high: 13000, year_low: 11000 };
                updateTasiDisplay(fallbackTasi);
                stocks.unshift(fallbackTasi);
            }

            allStocks = stocks;
            filterAndRenderStocks();

        }, (error) => {
            console.error("Error getting documents: ", error);
        });

        // Helper: Filter & Render
        function filterAndRenderStocks() {
            const searchInput = document.getElementById('stockSearch');
            const query = searchInput ? searchInput.value.toLowerCase() : '';

            const filtered = allStocks.filter(stock =>
                (stock.symbol && stock.symbol.toLowerCase().includes(query)) ||
                (stock.name && stock.name.toLowerCase().includes(query))
            );
            renderMarketTable(filtered);
        }

        const searchInput = document.getElementById('stockSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                filterAndRenderStocks();
            });
        }

        initChart();

    } catch (e) {
        console.error('Error initializing Firebase', e);
    }
});

let chart = null;
let candleSeries = null;
let volumeSeries = null;
let smaSeries = null;

// --- DROPDOWN LOGIC (Global) ---
window.toggleDropdown = () => {
    const dropdown = document.getElementById('indicators-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('show');
    }
};

// Close dropdown when clicking outside
window.onclick = (event) => {
    // Check if click occurred inside the toggle button
    if (!event.target.closest('.dropbtn')) {
        const dropdowns = document.getElementsByClassName("dropdown-content");
        for (let i = 0; i < dropdowns.length; i++) {
            const openDropdown = dropdowns[i];
            if (openDropdown.classList.contains('show')) {
                openDropdown.classList.remove('show');
            }
        }
    }
}

// --- DRAWING MANAGER (Global) ---
const DrawingManager = {
    mode: null,
    trendStart: null,
    verticalSeries: null,
    verticalData: [],
    drawnObjects: [],

    getTimeValue(t) {
        if (!t) return 0;
        if (typeof t === 'number') return t;
        if (typeof t === 'string') return new Date(t).getTime();
        if (typeof t === 'object') {
            if (t.year !== undefined && t.month !== undefined && t.day !== undefined) {
                return new Date(t.year, t.month - 1, t.day).getTime();
            }
            // If it's a Date object
            if (t instanceof Date) return t.getTime();
        }
        return 0;
    },

    start(mode, btnElement) {
        try {
            // UI Feedback
            document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));

            if (mode === this.mode) {
                this.mode = null;
                const container = document.getElementById('main_chart_container');
                if (container) container.style.cursor = 'default';
                this.trendStart = null;
                return;
            }

            if (btnElement && mode) {
                btnElement.classList.add('active');
            }

            this.mode = mode;
            const container = document.getElementById('main_chart_container');
            if (container) {
                if (mode) {
                    container.style.cursor = 'crosshair';
                } else {
                    container.style.cursor = 'default';
                    this.trendStart = null;
                }
            }
        } catch (e) { console.error(e); }
    },

    handleClick(param) {
        if (!this.mode) return;

        try {
            // Use window.chart / window.candleSeries explicitly if needed, but the global scope vars should work.
            // Safety check:
            const targetChart = chart || window.chart;
            const targetSeries = candleSeries || window.candleSeries;

            if (!targetSeries || !targetChart) return;

            // 1. Robust Time Retrieval
            let time = param.time;
            if (!time && param.point) {
                // Try to get time from coordinate for whitespace
                time = targetChart.timeScale().coordinateToTime(param.point.x);
            }

            if (!time || !param.point) return;

            const price = targetSeries.coordinateToPrice(param.point.y);

            // Vertical Line
            if (this.mode === 'vertical') {
                if (!this.verticalSeries) {
                    this.verticalSeries = targetChart.addHistogramSeries({
                        color: '#f59e0b',
                        priceFormat: { type: 'custom', formatter: () => '' },
                        priceScaleId: 'vertical-scales',
                    });
                    targetChart.priceScale('vertical-scales').applyOptions({
                        scaleMargins: { top: 0.1, bottom: 0 },
                        visible: false,
                    });
                    this.drawnObjects.push({ type: 'series', obj: this.verticalSeries, isVertical: true });
                }

                // Check duplicates using time value
                const timeVal = this.getTimeValue(time);
                if (!this.verticalData.find(t => this.getTimeValue(t.time) === timeVal)) {
                    this.verticalData.push({ time: time, value: 100, color: '#f59e0b' });
                    // Safe sort
                    this.verticalData.sort((a, b) => this.getTimeValue(a.time) - this.getTimeValue(b.time));
                    this.verticalSeries.setData(this.verticalData);
                }
                return;
            }

            // Horizontal Line
            if (this.mode === 'horizontal') {
                if (price) {
                    const line = targetSeries.createPriceLine({
                        price: price,
                        color: '#f59e0b',
                        lineWidth: 2,
                        lineStyle: 2,
                        axisLabelVisible: true,
                        title: 'H-Line',
                    });
                    this.drawnObjects.push({ type: 'priceLine', series: targetSeries, obj: line });
                }
                return;
            }

            // Trend Line
            if (this.mode === 'trend') {
                if (!this.trendStart) {
                    this.trendStart = { time: time, price: price };
                    if (window.showToast) showToast('حدد النقطة الثانية');
                } else {
                    let p1 = this.trendStart;
                    let p2 = { time: time, price: price };

                    // Compare values
                    const t1 = this.getTimeValue(p1.time);
                    const t2 = this.getTimeValue(p2.time);

                    if (t1 === t2 && p1.price === p2.price) {
                        return; // Clicked same spot
                    }

                    const tSeries = targetChart.addLineSeries({
                        color: '#f59e0b',
                        lineWidth: 2,
                        lineStyle: 0,
                        crosshairMarkerVisible: false,
                        lastValueVisible: false,
                        priceLineVisible: false,
                        autoscaleInfoProvider: () => null,
                        title: '',
                    });

                    let data = [p1, p2];

                    // Sort by time safely
                    if (t1 > t2) {
                        data = [p2, p1];
                    }

                    // Strict LWC check: times cannot be equal for LineSeries
                    if (this.getTimeValue(data[0].time) === this.getTimeValue(data[1].time)) {
                        if (window.showToast) showToast('لا يمكن رسم خط عمودي هنا');
                        // Clean up the empty series we just created?
                        // Actually LWC returns the series, but it's empty. We should probably remove it.
                        targetChart.removeSeries(tSeries);
                        return;
                    }

                    try {
                        tSeries.setData(data);
                        this.drawnObjects.push({ type: 'series', obj: tSeries });
                        this.trendStart = null;
                        // Reset cursor
                        // document.getElementById('main_chart_container').style.cursor = 'default';
                        // this.mode = null; // Should we stop drawing after one line? Usually users want to draw multiple. 
                        // Current behavior: keeps tool active. 
                    } catch (setErr) {
                        console.error("SetData Error:", setErr);
                        targetChart.removeSeries(tSeries);
                        if (window.showToast) showToast('حدث خطأ في الرسم');
                    }
                }
            }
        } catch (err) {
            console.error(err);
            if (window.showToast) showToast('خطأ: ' + err.message);
        }
    },

    clear() {
        this.drawnObjects.forEach(item => {
            try {
                if (item.type === 'priceLine') {
                    item.series.removePriceLine(item.obj);
                } else if (item.type === 'series') {
                    const targetChart = chart || window.chart;
                    if (targetChart) targetChart.removeSeries(item.obj);
                }
            } catch (e) { console.error(e); }
        });
        this.drawnObjects = [];
        this.verticalData = [];
        this.verticalSeries = null;
        this.trendStart = null;
    }
};

// Global Exposure
window.startDrawing = (mode, btn) => DrawingManager.start(mode, btn);
window.clearDrawings = () => DrawingManager.clear();

function initChart() {
    try {
        if (typeof LightweightCharts === 'undefined') {
            console.error('LightweightCharts library NOT loaded.');
            return;
        }

        const container = document.getElementById('main_chart_container');
        if (!container) return;

        container.innerHTML = '';

        const width = container.clientWidth || 800;
        const height = container.clientHeight || 500;

        chart = LightweightCharts.createChart(container, {
            width: width,
            height: height,
            layout: {
                background: { type: 'solid', color: '#000000' },
                textColor: '#94a3b8',
            },
            grid: {
                vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
                horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
            },
            rightPriceScale: {
                borderColor: 'rgba(255, 255, 255, 0.1)',
            },
            timeScale: {
                borderColor: 'rgba(255, 255, 255, 0.1)',
                timeVisible: true,
            },
            watermark: {
                visible: true,
                fontSize: 64,
                horzAlign: 'center',
                vertAlign: 'center',
                color: 'rgba(255, 255, 255, 0.05)',
                text: 'TASI',
            },
        });

        volumeSeries = chart.addHistogramSeries({
            color: '#26a69a',
            priceFormat: { type: 'volume' },
            priceScaleId: '',
        });

        volumeSeries.priceScale().applyOptions({
            scaleMargins: { top: 0.8, bottom: 0 },
        });

        candleSeries = chart.addCandlestickSeries({
            upColor: '#10b981',
            downColor: '#ef4444',
            borderVisible: false,
            wickUpColor: '#10b981',
            wickDownColor: '#ef4444',
        });

        smaSeries = chart.addLineSeries({
            color: '#2962FF',
            lineWidth: 2,
            crosshairMarkerVisible: false,
            title: 'SMA 20',
            visible: true
        });

        // Bollinger Bands placeholders
        bbUpperStub = chart.addLineSeries({ color: 'rgba(4, 111, 232, 0.6)', lineWidth: 2, visible: false, title: 'BB Upper' });
        bbLowerStub = chart.addLineSeries({ color: 'rgba(4, 111, 232, 0.6)', lineWidth: 2, visible: false, title: 'BB Lower' });

        // Subscribe to clicks for DrawingManager
        chart.subscribeClick((param) => {
            DrawingManager.handleClick(param);
        });

        // --- INDICATOR LOGIC ---
        window.toggleIndicator = (type) => {
            const isChecked = document.getElementById('chk-' + type.toLowerCase()).checked;

            if (type === 'VOL') {
                volumeSeries.applyOptions({ visible: isChecked });
                // If hidden, scale margins? Nah.
            }
            else if (type === 'SMA') {
                smaSeries.applyOptions({ visible: isChecked });
            }
            else if (type === 'BB') {
                // Logic to Show/Calculate BB is in loadChartData/update
                bbUpperStub.applyOptions({ visible: isChecked });
                bbLowerStub.applyOptions({ visible: isChecked });
                recalcIndicators();
            }
        };

        const resizeObserver = new ResizeObserver(entries => {
            if (entries.length === 0 || !entries[0].target) return;
            const newRect = entries[0].contentRect;
            if (newRect.width === 0 || newRect.height === 0) return;
            chart.applyOptions({ width: newRect.width, height: newRect.height });
        });
        resizeObserver.observe(container);

        // --- LEGEND LOGIC ---
        const legend = document.getElementById('chart-legend');

        if (legend) {
            legend.style.display = 'block';
            legend.innerHTML = `
                <div style="color: #94a3b8; padding: 8px;">Waiting for data...</div>
            `;
        }

        let latestDataPoint = null;

        function updateLegend(param) {
            if (!legend) return;

            let candleData, volumeData, smaData;

            // 1. Try Crosshair Data
            const validCrosshair = (
                param &&
                param.time &&
                param.point &&
                param.point.x >= 0 &&
                param.point.x < container.clientWidth &&
                param.point.y >= 0 &&
                param.point.y < container.clientHeight
            );

            if (validCrosshair && param.seriesData) {
                candleData = param.seriesData.get(candleSeries);
                volumeData = param.seriesData.get(volumeSeries);
                smaData = param.seriesData.get(smaSeries);
            }

            // 2. Fallback to Latest Data
            if (!candleData && latestDataPoint) {
                candleData = latestDataPoint.candle;
                volumeData = latestDataPoint.volume;
                smaData = latestDataPoint.sma;
            }

            // 3. If still no data, do nothing
            if (!candleData) {
                return;
            }

            // 4. Render
            const open = candleData.open ? candleData.open.toFixed(2) : '-';
            const high = candleData.high ? candleData.high.toFixed(2) : '-';
            const low = candleData.low ? candleData.low.toFixed(2) : '-';
            const close = candleData.close ? candleData.close.toFixed(2) : '-';

            // Volume formatting
            let volStr = '-';
            if (volumeData && volumeData.value !== undefined) {
                const v = volumeData.value;
                if (v >= 1000000) volStr = (v / 1000000).toFixed(2) + 'M';
                else if (v >= 1000) volStr = (v / 1000).toFixed(1) + 'K';
                else volStr = v.toString();
            }

            const sma = smaData && smaData.value ? smaData.value.toFixed(2) : '-';

            const isUp = (candleData.close || 0) >= (candleData.open || 0);
            const color = isUp ? '#10b981' : '#ef4444';

            const wmOptions = chart.options().watermark || {};
            // Use global currentSymbol if available, else watermark
            const displaySymbol = currentSymbol || wmOptions.text || 'TASI';
            const displayName = currentStockName || 'المؤشر العام';

            legend.innerHTML = `
                <div style="font-size: 14px; font-weight: bold; margin-bottom: 6px; color: ${color}; text-align: right; direction: rtl;">
                    ${displayName} <span style="font-weight: normal; opacity: 0.8; font-size: 0.9em;">(${displaySymbol})</span>
                </div>
                <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; direction: ltr;">
                    <span class="legend-label">O</span> <span class="legend-value">${open}</span>
                    <span class="legend-label">H</span> <span class="legend-value">${high}</span>
                    <span class="legend-label">L</span> <span class="legend-value">${low}</span>
                    <span class="legend-label">C</span> <span class="legend-value" style="color: ${color}">${close}</span>
                </div>
                


                <div style="display: flex; gap: 12px; font-size: 11px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px;">
                    <div>Vol: <span style="color: #e2e8f0;">${volStr}</span></div>
                    <div>SMA 20: <span style="color: #2962FF;">${sma}</span></div>
                </div>
            `;
        }

        chart.updateLegendDefault = (dataPkg) => {
            if (!dataPkg || !dataPkg.candles || !dataPkg.candles.length) return;
            const idx = dataPkg.candles.length - 1;
            latestDataPoint = {
                candle: dataPkg.candles[idx],
                volume: dataPkg.volume ? dataPkg.volume[idx] : null,
                sma: dataPkg.sma ? dataPkg.sma[idx] : null
            };
            // Force update
            updateLegend(null);
        };

        chart.subscribeCrosshairMove(updateLegend);

        // Initial Load
        loadChartData('TASI', 12450);

    } catch (e) {
        console.error(e);
    }
}

// --- NEW DATA FETCHING LOGIC ---

// Global store
let currentFullHistory = { candles: [], volume: [], sma: [], bbUpper: [], bbLower: [] };
let currentSymbol = 'TASI';
let currentStockName = 'المؤشر العام'; // Default name
let bbUpperStub, bbLowerStub; // Refs

function setChartTimeframe(period) {
    if (!currentFullHistory || currentFullHistory.candles.length === 0) return;

    // Update active button state
    document.querySelectorAll('.chart-controls .control-btn').forEach(btn => btn.classList.remove('active'));

    // Find button to active
    const buttons = document.querySelectorAll('.chart-controls .control-btn');
    for (let btn of buttons) {
        if (btn.textContent === period || (period === '1Y' && btn.id === 'btn-1Y')) {
            btn.classList.add('active');
            break;
        }
    }

    // Filter Data
    const cutoffDate = new Date();
    switch (period) {
        case '1W': cutoffDate.setDate(cutoffDate.getDate() - 7); break;
        case '1M': cutoffDate.setMonth(cutoffDate.getMonth() - 1); break;
        case '3M': cutoffDate.setMonth(cutoffDate.getMonth() - 3); break;
        case '6M': cutoffDate.setMonth(cutoffDate.getMonth() - 6); break;
        case '1Y': cutoffDate.setFullYear(cutoffDate.getFullYear() - 1); break;
        case 'ALL': cutoffDate.setFullYear(cutoffDate.getFullYear() - 20); break; // Way back
    }

    const filteredCandles = [];
    const filteredVolume = [];
    const filteredSma = [];
    const filteredBBU = [];
    const filteredBBL = [];

    for (let i = 0; i < currentFullHistory.candles.length; i++) {
        const itemDate = new Date(currentFullHistory.candles[i].time);
        if (itemDate >= cutoffDate) {
            filteredCandles.push(currentFullHistory.candles[i]);
            filteredVolume.push(currentFullHistory.volume[i]);
            if (currentFullHistory.sma && currentFullHistory.sma[i]) filteredSma.push(currentFullHistory.sma[i]);
            if (currentFullHistory.bbUpper && currentFullHistory.bbUpper[i]) filteredBBU.push(currentFullHistory.bbUpper[i]);
            if (currentFullHistory.bbLower && currentFullHistory.bbLower[i]) filteredBBL.push(currentFullHistory.bbLower[i]);
        }
    }

    // Apply to Chart
    candleSeries.setData(filteredCandles);
    if (volumeSeries) volumeSeries.setData(filteredVolume);
    if (smaSeries) smaSeries.setData(filteredSma);
    if (bbUpperStub) bbUpperStub.setData(filteredBBU);
    if (bbLowerStub) bbLowerStub.setData(filteredBBL);

    chart.timeScale().fitContent();
}

async function loadChartData(symbolInput, currentPrice = null) {
    if (!candleSeries || !db) return;

    // Normalize Symbol
    const symbol = symbolInput || 'TASI';
    currentSymbol = symbol;

    console.log(`Loading history for ${symbol}...`);

    // Update Watermark immediately
    if (chart) {
        chart.applyOptions({ watermark: { text: symbol } });
    }

    try {
        // 1. Try fetching from Firestore
        const historyRef = db.collection('stocks').doc(symbol).collection('history');
        // Fetch up to 1000 days for better 'ALL' range
        const snapshot = await historyRef.orderBy('time', 'asc').limit(1000).get();

        let data = { candles: [], volume: [], sma: [], bbUpper: [], bbLower: [] };

        if (!snapshot.empty) {
            console.log('Found existing history in DB.');
            // Process existing data
            let historyClose = [];

            snapshot.forEach(doc => {
                const item = doc.data();
                const time = item.time; // stored as YYYY-MM-DD

                // Candle
                data.candles.push({
                    time: time,
                    open: item.open,
                    high: item.high,
                    low: item.low,
                    close: item.close
                });

                // Volume
                const isUp = item.close >= item.open;
                data.volume.push({
                    time: time,
                    value: item.volume,
                    color: isUp ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)'
                });

                // SMA Prep
                historyClose.push(item.close);
            });

            // Calculate SMA on client side
            historyClose = [];
            data.candles.forEach(c => {
                historyClose.push(c.close);
                if (historyClose.length > 20) historyClose.shift();

                if (historyClose.length >= 20) {
                    const sum = historyClose.reduce((a, b) => a + b, 0);
                    const avg = sum / 20;
                    data.sma.push({ time: c.time, value: avg });

                    // BB Calculation (SD)
                    const sqDiffs = historyClose.map(val => Math.pow(val - avg, 2));
                    const avgSqDiff = sqDiffs.reduce((a, b) => a + b, 0) / 20;
                    const sd = Math.sqrt(avgSqDiff);

                    data.bbUpper.push({ time: c.time, value: avg + (2 * sd) });
                    data.bbLower.push({ time: c.time, value: avg - (2 * sd) });
                }
            });

            // Store full history
            currentFullHistory = data;

        } else {
            console.warn('No history found for ' + symbol);
            currentFullHistory = { candles: [], volume: [], sma: [], bbUpper: [], bbLower: [] };
        }

        // 3. Apply Data (Default to 1Y view)
        setChartTimeframe('1Y');

        // 4. Fit & Legend
        // (Handled inside setChartTimeframe)

        if (chart.updateLegendDefault) {
            chart.updateLegendDefault(currentFullHistory);
        }

    } catch (e) {
        console.error("Error loading chart data: ", e);
    }
}

// Helper to re-apply data to series based on visibility
// Called when Toggling indicators or switching Timeframes
// Note: setChartTimeframe now calls this too ideally? Or we duplicate filtering logic.
// Let's modify setChartTimeframe to handle all series.

window.recalcIndicators = () => {
    // Just trigger re-render of current timeframe
    const currentActiveBtn = document.querySelector('.chart-controls .control-btn.active');
    let period = '1Y';
    if (currentActiveBtn) period = currentActiveBtn.textContent;
    // Actually setChartTimeframe reads from currentFullHistory, so calling it refreshes the view
    // checking active button text is tricky if we changed logic.
    // Let's just find the active button:
    const btns = document.querySelectorAll('.chart-controls .control-btn');
    btns.forEach(b => {
        if (b.classList.contains('active') && !b.classList.contains('dropbtn')) {
            // It's a timeframe button hopefully
            const txt = b.textContent;
            if (['1W', '1M', '3M', '6M', '1Y', 'ALL'].includes(txt)) period = txt;
        }
    });

    setChartTimeframe(period);
};

function updateChart(stock) {
    console.log('Stock clicked:', stock);
    currentStockName = stock.name; // Capture Name
    loadChartData(stock.symbol, stock.price);
}

// function seedInitialData(db) { ... } // Removed

function renderMarketTable(stocksToRender) {
    const listBody = document.getElementById('market_table_body');
    if (!listBody) return;

    listBody.innerHTML = '';

    if (!stocksToRender || stocksToRender.length === 0) {
        listBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 20px;">لا توجد نتائج</td></tr>';
        return;
    }

    stocksToRender.forEach(stock => {
        const row = document.createElement('tr');

        const isPositive = stock.change >= 0;
        const colorClass = isPositive ? 'text-up' : 'text-down';
        const sign = isPositive ? '+' : '';

        row.onclick = () => {
            document.querySelectorAll('.data-table tr').forEach(r => r.classList.remove('active'));
            row.classList.add('active');
            updateChart(stock);
        };

        row.innerHTML = `
            <td>${stock.name}</td>
            <td class="col-symbol">${stock.symbol}</td>
            <td class="col-price">${stock.price?.toFixed(2) || '---'}</td>
            <td class="col-change ${colorClass}">
                ${sign}${stock.change?.toFixed(2) || '0.00'}
            </td>
            <td class="col-percent ${colorClass}">
                ${sign}${stock.percent?.toFixed(2) || '0.00'}%
            </td>
            <td class="col-high">${stock.year_high ? stock.year_high.toFixed(2) : '---'}</td>
            <td class="col-low">${stock.year_low ? stock.year_low.toFixed(2) : '---'}</td>
        `;

        listBody.appendChild(row);
    });
}

function updateHeaderDisplay(data) {
    const isTasi = data.symbol === 'TASI' || data.symbol === '^TASI.SR';

    if (isTasi) {
        const priceEl = document.getElementById('header-tasi-price');
        const changeEl = document.getElementById('header-tasi-change');

        // Check against undefined/null strictly, allow 0
        if (priceEl && data.price !== undefined && data.price !== null) {
            priceEl.textContent = data.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        } else {
            if (priceEl) priceEl.textContent = "---";
        }

        if (changeEl && data.change !== undefined) {
            const isPositive = data.change >= 0;
            const sign = isPositive ? '+' : '';
            changeEl.textContent = `${sign}${data.change.toFixed(2)} (${sign}${data.percent.toFixed(2)}%)`;

            changeEl.className = 'stat-value ' + (isPositive ? 'up' : 'down');
            priceEl.className = 'stat-value ' + (isPositive ? 'up' : 'down');
        }
    }
}

function updateTasiDisplay(data) {
    updateHeaderDisplay(data);
}

function toggleFullscreen(elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;
    element.classList.toggle('fullscreen');
}
