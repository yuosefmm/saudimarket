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
            if (tasiData) {
                updateTasiDisplay(tasiData);
                stocks.unshift(tasiData);
            } else {
                const dummyTasi = { symbol: 'TASI', name: 'المؤشر العام', price: 12450.20, change: 56.4, percent: 0.45, year_high: 13000, year_low: 11000 };
                updateTasiDisplay(dummyTasi);
                stocks.unshift(dummyTasi);
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
        });

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

            const wmOptions = chart.applyOptions().watermark || {};
            const symbolText = wmOptions.text || 'TASI';

            legend.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <span style="font-weight: 700; color: #fff; font-size: 14px;">${symbolText}</span>
                    <span style="color: #94a3b8; font-size: 11px;">${candleData.time || ''}</span>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; font-size: 12px; margin-bottom: 6px;">
                    <div><span style="color:#94a3b8">O</span> <span style="color:${color}">${open}</span></div>
                    <div><span style="color:#94a3b8">H</span> <span style="color:${color}">${high}</span></div>
                    <div><span style="color:#94a3b8">L</span> <span style="color:${color}">${low}</span></div>
                    <div><span style="color:#94a3b8">C</span> <span style="color:${color}">${close}</span></div>
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

async function loadChartData(symbolInput, currentPrice = null) {
    if (!candleSeries || !db) return;

    // Normalize Symbol
    const symbol = symbolInput || 'TASI';

    console.log(`Loading history for ${symbol}...`);

    // Update Watermark immediately
    if (chart) {
        chart.applyOptions({ watermark: { text: symbol } });
    }

    try {
        // 1. Try fetching from Firestore
        const historyRef = db.collection('stocks').doc(symbol).collection('history');
        // Fetch up to 500 days to ensure we cover the full active range (usually ~252 trading days/year)
        const snapshot = await historyRef.orderBy('time', 'asc').limit(500).get();

        let data = { candles: [], volume: [], sma: [] };

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
                    data.sma.push({ time: c.time, value: sum / 20 });
                }
            });

        } else {
            console.warn('No history found for ' + symbol);
            // DO NOT SEED FAKE DATA anymore.
            // data = await generateAndSeedHistory(symbol, currentPrice);
        }

        // 3. Apply Data
        candleSeries.setData(data.candles);
        if (volumeSeries) volumeSeries.setData(data.volume);
        if (smaSeries) smaSeries.setData(data.sma);

        // 4. Fit & Legend
        chart.timeScale().fitContent();
        chart.priceScale('right').applyOptions({ autoScale: true });

        if (chart.updateLegendDefault) {
            chart.updateLegendDefault(data);
        }

    } catch (e) {
        console.error("Error loading chart data: ", e);
    }
}

function updateChart(stock) {
    console.log('Stock clicked:', stock);
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

        if (priceEl && data.price) {
            priceEl.textContent = data.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
