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
let rsiSeries = null;
let macdSeries = null;
let macdSignalSeries = null;
let macdHistSeries = null;
let bbUpperStub = null;
let bbLowerStub = null;

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

    selectedObject: null,

    deselectObject() {
        if (!this.selectedObject) return;
        const item = this.selectedObject;
        this.selectedObject = null;
        try {
            if (item.type === 'priceLine') {
                item.obj.applyOptions({ lineColor: '#f59e0b', lineWidth: 2 });
            } else if (item.type === 'series') {
                if (!item.isVertical) item.obj.applyOptions({ color: '#f59e0b', lineWidth: 2 });
            } else if (item.type === 'vertical') {
                const idx = this.verticalData.findIndex(d => this.getTimeValue(d.time) === this.getTimeValue(item.time));
                if (idx !== -1) {
                    this.verticalData[idx].color = '#f59e0b';
                    if (this.verticalSeries) this.verticalSeries.setData(this.verticalData);
                }
            } else if (item.type === 'indicator') {
                // Restore Indicator Color
                const originalColor = item.originalColor || '#2962FF';
                item.obj.applyOptions({ color: originalColor, lineWidth: 2 });
            }
        } catch (e) { console.warn(e); }
    },

    selectObject(item) {
        this.deselectObject();
        this.selectedObject = item;
        try {
            if (item.type === 'priceLine') {
                item.obj.applyOptions({ lineColor: '#ef4444', lineWidth: 4 });
            } else if (item.type === 'series') {
                if (!item.isVertical) item.obj.applyOptions({ color: '#ef4444', lineWidth: 4 });
            } else if (item.type === 'vertical') {
                const idx = this.verticalData.findIndex(d => this.getTimeValue(d.time) === this.getTimeValue(item.time));
                if (idx !== -1) {
                    this.verticalData[idx].color = '#ef4444';
                    if (this.verticalSeries) this.verticalSeries.setData(this.verticalData);
                }
            } else if (item.type === 'indicator') {
                // Highlight Indicator
                item.obj.applyOptions({ color: '#ef4444', lineWidth: 4 });
            }
            if (window.showToast) showToast('تم التحديد - اضغط Delete للحذف');
        } catch (e) { console.warn(e); }
    },

    deleteSelected() {
        if (!this.selectedObject) return;
        const item = this.selectedObject;
        const targetChart = chart || window.chart;
        const targetSeries = candleSeries || window.candleSeries;
        try {
            if (item.type === 'priceLine') {
                targetSeries.removePriceLine(item.obj);
                this.drawnObjects = this.drawnObjects.filter(obj => obj.obj !== item.obj);
            } else if (item.type === 'series' && !item.isVertical) {
                targetChart.removeSeries(item.obj);
                this.drawnObjects = this.drawnObjects.filter(obj => obj.obj !== item.obj);
            } else if (item.type === 'vertical') {
                this.verticalData = this.verticalData.filter(d => this.getTimeValue(d.time) !== this.getTimeValue(item.time));
                if (this.verticalSeries) this.verticalSeries.setData(this.verticalData);
            } else if (item.type === 'indicator') {
                // Hide Indicator and Uncheck UI
                this.deselectObject(); // Restore color before hiding checks
                if (item.name === 'SMA') {
                    if (window.toggleIndicator) window.toggleIndicator('SMA');
                    const chk = document.getElementById('chk-sma');
                    if (chk) chk.checked = false;
                    // Ensure invisible
                    if (item.obj) item.obj.applyOptions({ visible: false });
                } else if (item.name === 'BB') {
                    // Hide Both Upper and Lower
                    const chk = document.getElementById('chk-bb');
                    if (chk) chk.checked = false;
                    if (bbUpperStub) bbUpperStub.applyOptions({ visible: false });
                    if (bbLowerStub) bbLowerStub.applyOptions({ visible: false });
                }
            }

            this.selectedObject = null;
            if (window.showToast) showToast('تم الحذف');
        } catch (e) { console.error(e); }
    },

    distToSegment(p, v, w) {
        const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
        if (l2 === 0) return Math.sqrt((p.x - v.x) ** 2 + (p.y - v.y) ** 2);
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.sqrt((p.x - (v.x + t * (w.x - v.x))) ** 2 + (p.y - (v.y + t * (w.y - v.y))) ** 2);
    },

    hitTest(param) {
        if (!param.point) return null;
        const targetChart = chart || window.chart;
        const targetSeries = candleSeries || window.candleSeries;
        if (!targetChart || !targetSeries) return null;

        const x = param.point.x;
        const y = param.point.y;

        // 1. Horizontal & Trend
        for (let item of this.drawnObjects) {
            if (item.type === 'priceLine') {
                const lineY = targetSeries.priceToCoordinate(item.price);
                if (lineY !== null && Math.abs(lineY - y) < 10) return item;
            } else if (item.type === 'series' && !item.isVertical && item.data) {
                const p1 = item.data[0];
                const p2 = item.data[1];
                const x1 = targetChart.timeScale().timeToCoordinate(p1.time);
                const x2 = targetChart.timeScale().timeToCoordinate(p2.time);
                const y1 = targetSeries.priceToCoordinate(p1.value);
                const y2 = targetSeries.priceToCoordinate(p2.value);
                if (x1 !== null && x2 !== null && y1 !== null && y2 !== null) {
                    if (this.distToSegment({ x, y }, { x: x1, y: y1 }, { x: x2, y: y2 }) < 10) return item;
                }
            }
        }
        // 2. Vertical
        const timeScale = targetChart.timeScale();
        for (let v of this.verticalData) {
            const vx = timeScale.timeToCoordinate(v.time);
            if (vx !== null && Math.abs(vx - x) < 5) return { type: 'vertical', time: v.time };
        }

        // 3. Indicators (SMA, BB)
        // Check SMA
        if (smaSeries && smaSeries.options().visible) {
            const data = param.seriesData.get(smaSeries);
            if (data && data.value) {
                const smaY = smaSeries.priceToCoordinate(data.value);
                if (smaY !== null && Math.abs(smaY - y) < 10) {
                    return { type: 'indicator', name: 'SMA', obj: smaSeries, originalColor: '#2962FF' };
                }
            }
        }
        // Check BB (Upper)
        if (bbUpperStub && bbUpperStub.options().visible) {
            const data = param.seriesData.get(bbUpperStub);
            if (data && data.value) {
                const bbY = bbUpperStub.priceToCoordinate(data.value);
                if (bbY !== null && Math.abs(bbY - y) < 10) {
                    return { type: 'indicator', name: 'BB', obj: bbUpperStub, originalColor: 'rgba(4, 111, 232, 0.6)' };
                }
            }
        }
        // Check BB (Lower)
        if (bbLowerStub && bbLowerStub.options().visible) {
            const data = param.seriesData.get(bbLowerStub);
            if (data && data.value) {
                const bbY = bbLowerStub.priceToCoordinate(data.value);
                if (bbY !== null && Math.abs(bbY - y) < 10) {
                    // Note: We use the LOWER stub object. But 'BB' name implies grouping.
                    return { type: 'indicator', name: 'BB', obj: bbLowerStub, originalColor: 'rgba(4, 111, 232, 0.6)' };
                }
            }
        }

        return null;
    },

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
                this.removePreview(); // Cleanup
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
                    this.removePreview();
                }
            }
        } catch (e) { console.error(e); }
    },

    previewSeries: null,

    removePreview() {
        if (this.previewSeries) {
            const targetChart = chart || window.chart;
            if (targetChart) targetChart.removeSeries(this.previewSeries);
            this.previewSeries = null;
        }
    },

    handleMove(param) {
        if (this.mode !== 'trend' || !this.trendStart) return;

        const targetChart = chart || window.chart;
        const targetSeries = candleSeries || window.candleSeries;
        if (!targetChart || !targetSeries) return;

        const time = param.time || (param.point ? targetChart.timeScale().coordinateToTime(param.point.x) : null);
        if (!time || !param.point) return;

        const price = targetSeries.coordinateToPrice(param.point.y);

        // Create preview series if not exists
        if (!this.previewSeries) {
            this.previewSeries = targetChart.addLineSeries({
                color: '#f59e0b',
                lineWidth: 2,
                lineStyle: 2, // Dashed for preview
                crosshairMarkerVisible: false,
                lastValueVisible: false,
                priceLineVisible: false,
                title: '',
            });
        }

        let p1 = this.trendStart;
        let p2 = { time: time, price: price };

        let data = [
            { time: p1.time, value: p1.price },
            { time: p2.time, value: p2.price }
        ];

        const t1 = this.getTimeValue(p1.time);
        const t2 = this.getTimeValue(p2.time);

        if (t1 > t2) {
            data = [
                { time: p2.time, value: p2.price },
                { time: p1.time, value: p1.price }
            ];
        }

        // Only set data if times are different
        if (t1 !== t2) {
            this.previewSeries.setData(data);
        }
    },

    handleClick(param) {
        // Selection Mode
        if (!this.mode) {
            const hit = this.hitTest(param);
            if (hit) {
                this.selectObject(hit);
            } else {
                this.deselectObject();
            }
            return;
        }

        try {
            const targetChart = chart || window.chart;
            const targetSeries = candleSeries || window.candleSeries;

            if (!targetSeries || !targetChart) return;

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
                    this.drawnObjects.push({ type: 'priceLine', series: targetSeries, obj: line, price: price });
                }
                return;
            }

            // Trend Line
            if (this.mode === 'trend') {
                if (!this.trendStart) {
                    // FIRST CLICK
                    this.trendStart = { time: time, price: price };
                    // Don't show toast, user wants visuals
                } else {
                    // SECOND CLICK
                    // SECOND CLICK - Fix Recursion
                    let p1 = this.trendStart;
                    let p2 = { time: time, price: price };

                    // IMPORTANT: Disable interaction BEFORE cleanup to prevent recursion
                    this.trendStart = null;

                    const t1 = this.getTimeValue(p1.time);
                    const t2 = this.getTimeValue(p2.time);

                    if (t1 === t2 && p1.price === p2.price) {
                        this.removePreview();
                        return;
                    }

                    // Safe cleanup
                    this.removePreview();

                    const tSeries = targetChart.addLineSeries({
                        color: '#f59e0b',
                        lineWidth: 2,
                        lineStyle: 0,
                        crosshairMarkerVisible: false,
                        lastValueVisible: false,
                        priceLineVisible: false,
                        title: '',
                    });

                    let data = [
                        { time: p1.time, value: p1.price },
                        { time: p2.time, value: p2.price }
                    ];

                    if (t1 > t2) {
                        data = [
                            { time: p2.time, value: p2.price },
                            { time: p1.time, value: p1.price }
                        ];
                    }

                    // Validate prices
                    if (!Number.isFinite(p1.price) || !Number.isFinite(p2.price)) {
                        targetChart.removeSeries(tSeries);
                        if (window.showToast) showToast('خطأ: السعر غير صالح');
                        return;
                    }

                    if (this.getTimeValue(data[0].time) === this.getTimeValue(data[1].time)) {
                        targetChart.removeSeries(tSeries);
                        if (window.showToast) showToast('خطأ: التوقيت متطابق');
                        return;
                    }

                    try {
                        tSeries.setData(data);
                        this.drawnObjects.push({ type: 'series', obj: tSeries, data: data });
                        if (window.showToast) showToast('تم التثبيت');
                    } catch (setErr) {
                        console.error("SetData Error:", setErr);
                        targetChart.removeSeries(tSeries);
                        if (window.showToast) showToast('فشل الرسم: ' + setErr.message);
                    }
                }
            }
        } catch (err) {
            console.error(err);
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

// Keyboard Listener for Deletion
document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
        DrawingManager.deleteSelected();
    }
});

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

        // RSI Series (Separate Scale)
        rsiSeries = chart.addLineSeries({
            color: '#a855f7', // Purple
            lineWidth: 2,
            priceScaleId: 'rsi', // Custom Scale
            visible: false,
            title: 'RSI 14'
        });
        chart.priceScale('rsi').applyOptions({
            scaleMargins: { top: 0.8, bottom: 0 },
            visible: false
        });

        // MACD Series (Separate Scale)
        macdSeries = chart.addLineSeries({
            color: '#2962FF',
            lineWidth: 2,
            priceScaleId: 'macd',
            visible: false,
            title: 'MACD'
        });
        macdSignalSeries = chart.addLineSeries({
            color: '#FF6D00',
            lineWidth: 2,
            priceScaleId: 'macd',
            visible: false,
            title: 'Signal'
        });
        macdHistSeries = chart.addHistogramSeries({
            color: '#26a69a',
            priceScaleId: 'macd',
            visible: false,
            title: 'Hist'
        });
        chart.priceScale('macd').applyOptions({
            scaleMargins: { top: 0.8, bottom: 0 },
            visible: false
        });

        // Subscribe to clicks for DrawingManager
        chart.subscribeClick((param) => {
            DrawingManager.handleClick(param);
        });

        // --- RESIZE OBSERVER (Responsive) ---
        const resizeObserver = new ResizeObserver(entries => {
            if (entries.length === 0 || !entries[0].contentRect) return;
            const newRect = entries[0].contentRect;
            chart.applyOptions({ width: newRect.width, height: newRect.height });
            // FORCE RE-RENDER / FIT
            chart.timeScale().fitContent();
        });
        resizeObserver.observe(container);

        // Subscribe to move for Interactive Drawing
        chart.subscribeCrosshairMove((param) => {
            DrawingManager.handleMove(param);
            updateLegend(param); // Existing legend update
        });

        // --- INDICATOR LOGIC ---
        // --- INDICATOR LOGIC ---
        window.toggleIndicator = (type) => {
            const chk = document.getElementById('chk-' + type.toLowerCase());
            if (!chk) return;
            const isChecked = chk.checked;

            if (type === 'VOL') {
                if (volumeSeries) volumeSeries.applyOptions({ visible: isChecked });
            }
            else if (type === 'SMA') {
                if (smaSeries) smaSeries.applyOptions({ visible: isChecked });
            }
            else if (type === 'BB') {
                if (bbUpperStub) bbUpperStub.applyOptions({ visible: isChecked });
                if (bbLowerStub) bbLowerStub.applyOptions({ visible: isChecked });
            }
            else if (type === 'RSI') {
                if (rsiSeries) {
                    rsiSeries.applyOptions({ visible: isChecked });
                    chart.priceScale('rsi').applyOptions({ visible: isChecked });
                }
            }
            else if (type === 'MACD') {
                if (macdSeries) {
                    macdSeries.applyOptions({ visible: isChecked });
                    macdSignalSeries.applyOptions({ visible: isChecked });
                    macdHistSeries.applyOptions({ visible: isChecked });
                    chart.priceScale('macd').applyOptions({ visible: isChecked });
                }
            }

            // Layout Resizing Logic (Dual Pane Simulation)
            const showRSI = document.getElementById('chk-rsi') && document.getElementById('chk-rsi').checked;
            const showMACD = document.getElementById('chk-macd') && document.getElementById('chk-macd').checked;
            const anyBottomIndicator = showRSI || showMACD;

            if (anyBottomIndicator) {
                // Shrink Main Chart to top 70%
                if (candleSeries) candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0, bottom: 0.3 } });
                // Ensure Volume is at bottom (overlaying indicator? or shrink it?)
                // Default Volume top:0.8 means bottom 20%.
                // Indicators are also bottom 20%.
                // It's acceptable overlap or we can hide volume if congested.
                // Let's keep it.
            } else {
                // Restore Full Height
                if (candleSeries) candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0, bottom: 0 } });
            }

            recalcIndicators();
        };



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
                // 5. Drawing Manager
                drawingManager = new DrawingManager(chart, candleSeries);

                // 6. Handle Resize
                const resizeObserver = new ResizeObserver(entries => {
                    if (entries.length === 0 || !entries[0].contentRect) return;
                    const newRect = entries[0].contentRect;
                    chart.applyOptions({ width: newRect.width, height: newRect.height });
                });
                resizeObserver.observe(container);

                // Initial Resize
                const rect = container.getBoundingClientRect();
                chart.applyOptions({ width: rect.width, height: rect.height });
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
// Refs declared at top

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

    // Filter Helper
    const filterByDate = (arr) => {
        if (!arr) return [];
        return arr.filter(item => {
            if (!item.time) return false;
            const t = new Date(item.time);
            return t >= cutoffDate;
        });
    };

    const filteredCandles = filterByDate(currentFullHistory.candles);
    const filteredVolume = filterByDate(currentFullHistory.volume);
    const filteredSma = filterByDate(currentFullHistory.sma);
    const filteredBBU = filterByDate(currentFullHistory.bbUpper);
    const filteredBBL = filterByDate(currentFullHistory.bbLower);

    // Indicators
    const filteredRSI = filterByDate(currentFullHistory.rsi);
    const filteredMACD = filterByDate(currentFullHistory.macd);
    const filteredMACDSignal = filterByDate(currentFullHistory.macdSignal);
    const filteredMACDHist = filterByDate(currentFullHistory.macdHist);

    // Apply to Chart
    if (candleSeries) candleSeries.setData(filteredCandles);
    if (volumeSeries) volumeSeries.setData(filteredVolume);
    if (smaSeries) smaSeries.setData(filteredSma);
    if (bbUpperStub) bbUpperStub.setData(filteredBBU);
    if (bbLowerStub) bbLowerStub.setData(filteredBBL);

    if (rsiSeries) rsiSeries.setData(filteredRSI);
    if (macdSeries) macdSeries.setData(filteredMACD);
    if (macdSignalSeries) macdSignalSeries.setData(filteredMACDSignal);
    if (macdHistSeries) macdHistSeries.setData(filteredMACDHist);

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
                const openVal = parseFloat(item.open);
                const highVal = parseFloat(item.high);
                const lowVal = parseFloat(item.low);
                const closeVal = parseFloat(item.close);
                const volVal = parseFloat(item.volume);

                if (isNaN(closeVal)) return; // Skip invalid records

                data.candles.push({
                    time: time,
                    open: openVal,
                    high: highVal,
                    low: lowVal,
                    close: closeVal
                });

                // Volume
                const isUp = closeVal >= openVal;
                data.volume.push({
                    time: time,
                    value: isNaN(volVal) ? 0 : volVal,
                    color: isUp ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)'
                });

                // SMA Prep
                historyClose.push(closeVal);
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

            // Calculate RSI & MACD
            // Re-build full history array from clean candles just to be safe
            const cleanPrices = data.candles.map(c => c.close);

            const rsiValues = calculateRSI(cleanPrices);
            const macdValues = calculateMACD(cleanPrices);

            data.rsi = [];
            data.macd = [];
            data.macdSignal = [];
            data.macdHist = [];

            data.candles.forEach((c, i) => {
                // RSI
                const rVal = rsiValues[i];
                if (rVal !== null && rVal !== undefined && !isNaN(rVal)) {
                    data.rsi.push({ time: c.time, value: rVal });
                }

                // MACD
                if (macdValues.macd[i] !== null && !isNaN(macdValues.macd[i])) {
                    data.macd.push({ time: c.time, value: macdValues.macd[i] });
                    data.macdSignal.push({ time: c.time, value: macdValues.signal[i] });

                    const histVal = macdValues.hist[i];
                    const color = histVal >= 0 ? '#26a69a' : '#ef4444';
                    data.macdHist.push({ time: c.time, value: histVal, color: color });
                }
            });

            // Store full history
            currentFullHistory = data;
            currentFullHistory.rsi = data.rsi; // ensure explicit access
            currentFullHistory.macd = data.macd;
            currentFullHistory.macdSignal = data.macdSignal;
            currentFullHistory.macdHist = data.macdHist;

        } else {
            console.warn('No history found for ' + symbol);
            currentFullHistory = { candles: [], volume: [], sma: [], bbUpper: [], bbLower: [], rsi: [], macd: [], macdSignal: [], macdHist: [] };
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

// --- INDICATOR HELPERS ---

function calculateRSI(prices, period = 14) {
    if (prices.length < period) return [];

    let result = [];
    // Need alignment with timestamps. We assume prices array matches candles array index-wise.
    // However, RSI starts after 'period'.
    // We'll return an array of { value: rsi } or nulls for first N items.

    let gains = 0;
    let losses = 0;

    // First RSI
    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Fill first 'period' with nulls
    for (let i = 0; i < period; i++) result.push(null);

    let firstRS = avgGain / avgLoss;
    let firstRSI = 100 - (100 / (1 + firstRS));
    if (avgLoss === 0) firstRSI = 100;

    result.push(firstRSI);

    // Rest
    for (let i = period + 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        let gain = change > 0 ? change : 0;
        let loss = change < 0 ? Math.abs(change) : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;

        let rs = avgGain / avgLoss;
        let rsi = 100 - (100 / (1 + rs));
        if (avgLoss === 0) rsi = 100;

        result.push(rsi);
    }

    return result;
}

function calculateMACD(prices, fast = 12, slow = 26, signal = 9) {
    if (prices.length < slow) return { macd: [], signal: [], hist: [] };

    function calculateEMA(data, period) {
        const k = 2 / (period + 1);
        let emaArray = [];
        // SMA for first value
        if (data.length < period) return [];
        let sum = 0;
        for (let i = 0; i < period; i++) sum += data[i];
        let ema = sum / period;

        for (let i = 0; i < period - 1; i++) emaArray.push(null);
        emaArray.push(ema);

        for (let i = period; i < data.length; i++) {
            ema = (data[i] * k) + (emaArray[i - 1] || ema) * (1 - k);
            emaArray.push(ema);
        }
        return emaArray;
    }

    const emaFast = calculateEMA(prices, fast);
    const emaSlow = calculateEMA(prices, slow);

    const macdLine = [];
    for (let i = 0; i < prices.length; i++) {
        if (emaFast[i] !== null && emaSlow[i] !== null) {
            macdLine.push(emaFast[i] - emaSlow[i]);
        } else {
            macdLine.push(null);
        }
    }

    // Signal Line (EMA of MACD Line)
    // We need to strip nulls to calc EMA, then map back?
    // Easier: Just calc EMA on the valid part.
    // Logic: Find first non-null index
    let startIdx = 0;
    while (startIdx < macdLine.length && macdLine[startIdx] === null) startIdx++;

    const validMacd = macdLine.slice(startIdx);
    const validSignal = calculateEMA(validMacd, signal);

    const signalLine = [];
    // Pad with nulls
    for (let i = 0; i < startIdx; i++) signalLine.push(null);
    // Combine
    for (let i = 0; i < validSignal.length; i++) {
        signalLine.push(validSignal[i]); // validSignal already has nulls for its own warmup? Yes calculateEMA does that.
    }

    const hist = [];
    for (let i = 0; i < prices.length; i++) {
        if (macdLine[i] !== null && signalLine[i] !== null) {
            hist.push(macdLine[i] - signalLine[i]);
        } else {
            hist.push(null);
        }
    }

    return { macd: macdLine, signal: signalLine, hist: hist };
}

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
