const firebaseConfig = {
    apiKey: "AIzaSyASIYtMpcUsEF0K2HJ5GSYMjuzgGuHwEHg",
    authDomain: "saudimarkety.firebaseapp.com",
    projectId: "saudimarkety",
    storageBucket: "saudimarkety.firebasestorage.app",
    messagingSenderId: "840509227192",
    appId: "1:840509227192:web:36935a0411b8647816744d",
    measurementId: "G-6WZ1L6P61E"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// --- Chart Variables ---
let chart = null;
let candleSeries = null;
let volumeSeries = null;
let smaSeries = null;
let bbUpperSeries = null;
let bbLowerSeries = null;
let rsiSeries = null;
let currentSymbol = null;

// --- Chart Initialization ---
// --- Chart Initialization ---
function initChart() {
    // Reset all global series variables to ensure a clean state
    candleSeries = null;
    volumeSeries = null;
    smaSeries = null;
    bbUpperSeries = null;
    bbLowerSeries = null;
    rsiSeries = null;

    const container = document.getElementById('strategy-chart');
    if (!container) {
        console.error("Chart Container not found!");
        return false;
    }

    if (typeof LightweightCharts === 'undefined') {
        console.error("LightweightCharts library not loaded!");
        document.getElementById('chart-overlay').innerHTML = `<div style="color:red">Error: Chart Library Missing</div>`;
        return false;
    }

    // Destroy existing chart if it exists
    try {
        if (chart) {
            chart.remove();
            chart = null;
        }
    } catch (e) {
        console.warn("Error removing old chart:", e);
        chart = null;
    }

    try {
        chart = LightweightCharts.createChart(container, {
            layout: {
                background: { type: 'solid', color: 'transparent' },
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
        });

        volumeSeries = chart.addHistogramSeries({
            color: '#26a69a',
            priceFormat: { type: 'volume' },
            priceScaleId: '',
        });
        volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

        candleSeries = chart.addCandlestickSeries({
            upColor: '#10b981',
            downColor: '#ef4444',
            borderVisible: false,
            wickUpColor: '#10b981',
            wickDownColor: '#ef4444',
        });

        // Strategy Overlays
        smaSeries = chart.addLineSeries({ color: '#2962FF', lineWidth: 2, visible: false, title: 'SMA 20' });
        bbUpperSeries = chart.addLineSeries({ color: 'rgba(4, 111, 232, 0.5)', lineWidth: 1, visible: false });
        bbLowerSeries = chart.addLineSeries({ color: 'rgba(4, 111, 232, 0.5)', lineWidth: 1, visible: false });

        // RSI (Separate Scale)
        rsiSeries = chart.addLineSeries({
            color: '#a855f7',
            lineWidth: 2,
            priceScaleId: 'rsi',
            visible: false,
            title: 'RSI 14'
        });
        chart.priceScale('rsi').applyOptions({
            scaleMargins: { top: 0.8, bottom: 0 },
            visible: false
        });

        // Resize Observer
        new ResizeObserver(entries => {
            if (entries.length === 0 || !entries[0].contentRect) return;
            const newRect = entries[0].contentRect;
            chart.applyOptions({ width: newRect.width, height: newRect.height });
        }).observe(container);

        return true;

    } catch (e) {
        console.error("Error creating chart:", e);
        document.getElementById('chart-overlay').innerHTML = `<div style="color:red">Chart Init Failed: ${e.message}</div>`;
        return false;
    }
}

async function loadChartForSymbol(symbol, companyName, strategyMode) {
    if (!chart || !candleSeries || !volumeSeries) {
        const success = initChart();
        if (!success) {
            console.error("Failed to initialize chart in loadChartForSymbol");
            return;
        }
    }

    currentSymbol = symbol;

    // UI Updates
    document.getElementById('chart-overlay').style.display = 'flex';
    document.getElementById('chart-overlay').innerHTML = `<div>جار جلب البيانات...</div>`;

    const strategyNames = {
        'gainers': 'الأكثر ارتفاعاً',
        'losers': 'الأكثر انخفاضاً',
        'volume': 'الأعلى سيولة',
        'breakout': 'اختراق قوي (سيولة)',
        'speculative': 'فرص مضاربية',
        'reversal': 'بداية انعكاس',
        'morning_star': 'نموذج الصباح',
        'donchian_breakout': 'اختراق دونشيان',
        'vwap_bounce': 'ارتكاز VWAP',
        'bullish_div': 'دايفرجنس إيجابي',
        'overbought': 'تضخم شرائي'
    };
    const strategyTitle = strategyNames[strategyMode] || strategyMode;
    const titleText = companyName ? `${companyName} (${symbol}) - ${strategyTitle}` : `${symbol} - ${strategyTitle}`;
    document.getElementById('chart-title').innerText = titleText;

    document.getElementById('chart-card').style.opacity = '1';
    document.getElementById('chart-card').style.pointerEvents = 'all';

    try {
        // 1. Determine Resolution
        let resolution = '1D';
        const intradayStrategies = ['morning_star', 'vwap_bounce', 'bullish_div'];
        if (intradayStrategies.includes(strategyMode)) {
            resolution = '15m'; // Force 15m for these strategies
        }

        // 2. Fetch Data (Using Shared Util)
        const rawJson = await fetchStockHistory(symbol, resolution);

        // 3. Process Data (Using Shared Util)
        const data = processStockData(rawJson);

        // 4. Render to Chart
        candleSeries.setData(data.candles);
        volumeSeries.setData(data.volume);

        // Update Status
        if (resolution !== '1D') {
            document.getElementById('chart-status').innerHTML += ` <span style="color:#aaa; font-size:10px;">(${resolution})</span>`;
        }

        const lastCandle = data.candles[data.candles.length - 1];
        if (lastCandle) {
            const prevClose = data.candles.length > 1 ? data.candles[data.candles.length - 2].close : lastCandle.close;
            const priceColor = (lastCandle.close >= prevClose) ? '#10b981' : '#ef4444';
            document.getElementById('chart-status').innerHTML = `
                <span dir="ltr" style="color: ${priceColor}; font-weight: bold; font-family: 'JetBrains Mono', monospace; font-size: 14px;">
                    ${lastCandle.close.toFixed(2)}
                </span>
             `;
        } else {
            document.getElementById('chart-status').innerText = '';
        }

        document.getElementById('chart-overlay').style.display = 'none';

        // 5. Apply Indicators (Pass processed data to avoid recalc)
        applyStrategyIndicators(strategyMode, data);

        chart.timeScale().fitContent();

    } catch (e) {
        console.error(e);
        document.getElementById('chart-overlay').innerHTML = `<div style="text-align:center; color: #ef4444;">Error: ${e.message}</div>`;
    }
}

function applyStrategyIndicators(mode, data) {
    const candles = data.candles;

    // Reset all
    smaSeries.applyOptions({ visible: false });
    bbUpperSeries.applyOptions({ visible: false });
    bbLowerSeries.applyOptions({ visible: false });
    rsiSeries.applyOptions({ visible: false });
    chart.priceScale('rsi').applyOptions({ visible: false });
    candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.2 } }); // Default margins

    if (mode === 'donchian_breakout' || mode === 'breakout' || mode === 'speculative') {
        // Show SMA 20 (Pre-calculated)
        if (data.sma && data.sma.length > 0) {
            smaSeries.setData(data.sma);
            smaSeries.applyOptions({ visible: true });
        }

        // Show Donchian Channel (20 High/Low) - Custom Calc still needed
        // We reused BB series for these lines visually
        const high20 = calculateDonchian(candles, 20, 'high');
        const low20 = calculateDonchian(candles, 20, 'low');

        bbUpperSeries.setData(high20);
        bbUpperSeries.applyOptions({ visible: true, title: 'Upper 20', color: '#4caf50' });

        bbLowerSeries.setData(low20);
        bbLowerSeries.applyOptions({ visible: true, title: 'Lower 20', color: '#ef4444' });
    }

    if (mode === 'vwap_bounce') {
        // VWAP proxy using SMA 20 (or calculate true VWAP if added to utils)
        if (data.sma && data.sma.length > 0) {
            smaSeries.setData(data.sma);
            smaSeries.applyOptions({ visible: true, title: 'SMA 20 (Ref)' });
        }
    }

    if (mode === 'overbought' || mode === 'speculative' || mode === 'reversal' || mode === 'bullish_div') {
        // Use Pre-calculated RSI
        if (data.rsi && data.rsi.length > 0) {
            rsiSeries.setData(data.rsi);
            rsiSeries.applyOptions({ visible: true });
            chart.priceScale('rsi').applyOptions({ visible: true });
            candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.3 } }); // Make room for RSI
        }
    }
}

// --- Indicators Calculation ---
// calculateSMA and calculateRSI removed (using shared utils/pre-calc)

function calculateDonchian(candles, period, type) {
    const result = [];
    for (let i = 0; i < candles.length; i++) {
        if (i < period - 1) { continue; }
        // Let's take max of LAST period candles (inclusive of current for Breakout context, or exclusive?)
        // Standard Donchian is usually High of last N days. If today breaks it, it's a breakout.
        let slice = candles.slice(i - period + 1, i + 1);
        let val = 0;
        if (type === 'high') val = Math.max(...slice.map(c => c.high));
        if (type === 'low') val = Math.min(...slice.map(c => c.low));
        result.push({ time: candles[i].time, value: val });
    }
    return result;
}

function calculateRSI(candles, period) {
    const result = [];
    let gains = 0, losses = 0;
    // Simple RSI implementation
    for (let i = 1; i < candles.length; i++) {
        const change = candles[i].close - candles[i - 1].close;
        if (i <= period) {
            if (change > 0) gains += change; else losses += Math.abs(change);
            if (i === period) {
                let avgGain = gains / period;
                let avgLoss = losses / period;
                let rs = avgGain / avgLoss;
                result.push({ time: candles[i].time, value: 100 - (100 / (1 + rs)) });
            }
        } else {
            // Smoothed
            let gain = change > 0 ? change : 0;
            let loss = change < 0 ? Math.abs(change) : 0;
            // We need previous averages. But simplified for this view:
            // Re-calculate or use array?
            // Let's stick to standard formula if possible, but for 'preview' simple is OK.
            // Actually to match server, we should be precise, but clientside approx is enough for visual.

            // Accurate way:
            // We need to keep track of avgGain, avgLoss
        }
    }
    // Re-impl proper Loop
    let rsiArray = [];
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i < candles.length; i++) {
        const change = candles[i].close - candles[i - 1].close;
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;

        if (i <= period) {
            avgGain += gain;
            avgLoss += loss;
            if (i === period) {
                avgGain /= period;
                avgLoss /= period;
                const rs = avgGain / avgLoss;
                rsiArray.push({ time: candles[i].time, value: 100 - (100 / (1 + rs)) });
            }
        } else {
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
            const rs = avgGain / avgLoss;
            rsiArray.push({ time: candles[i].time, value: 100 - (100 / (1 + rs)) });
        }
    }
    return rsiArray;
}


// --- Strategy Configuration ---
const STRATEGIES = {
    'gainers': {
        title: 'الأكثر ارتفاعاً 🚀',
        desc: 'الأسهم الأكثر ارتفاعاً اليوم. تعكس إيجابية لحظية وسيولة داخلة.',
        filter: (data) => [...data].sort((a, b) => (b.percent || 0) - (a.percent || 0)).slice(0, 20)
    },
    'losers': {
        title: 'الأكثر انخفاضاً 🔻',
        desc: 'الأسهم الأكثر انخفاضاً اليوم. قد تكون فرص ارتداد أو استمرار في السلبية.',
        filter: (data) => [...data].sort((a, b) => (a.percent || 0) - (b.percent || 0)).slice(0, 20)
    },
    'volume': {
        title: 'الأعلى سيولة 💰',
        desc: 'الأسهم الأعلى حجم تداول (كميات). السيولة العالية وقود الحركة السعرية.',
        filter: (data) => [...data].filter(s => s.volume).sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 20),
        emptyMsg: 'بيانات السيولة غير متوفرة حالياً'
    },
    'speculative': {
        title: 'فرص مضاربية (ذهبية) ✨',
        desc: 'أسهم خفيفة وسريعة الحركة (عدد أسهم حرة قليل) مع وضع فني إيجابي.',
        filter: (data) => data.filter(s => {
            if (!s.rsi_14 || !s.sma_20) return false;
            return (s.rsi_14 >= 50 && s.rsi_14 <= 70) && (s.price > s.sma_20) && (s.macd > s.macd_signal);
        }).sort((a, b) => (b.percent || 0) - (a.percent || 0)).slice(0, 10),
        emptyMsg: 'لا توجد فرص مطابقة للشروط حالياً (تحتاج تحديث البيانات)'
    },
    'reversal': {
        title: 'بداية انعكاس إيجابي 🔄',
        desc: 'أسهم أغلقت بذيل سفلي طويل (Hammer) أو تقاطعات إيجابية عند قيعان.',
        filter: (data) => data.filter(s => {
            if (!s.macd || !s.macd_signal) return false;
            return (s.macd > s.macd_signal) && (s.rsi_14 && s.rsi_14 < 60);
        }).sort((a, b) => (b.macd_hist || 0) - (a.macd_hist || 0)).slice(0, 10),
        emptyMsg: 'لا توجد إشارات انعكاس واضحة حالياً'
    },
    'breakout': {
        title: 'اختراق قوي (سيولة) 💥',
        desc: 'أسهم تخترق مقاومات سعرية بزيادة ملحوظة في الفوليوم.',
        filter: (data) => data.filter(s => (s.percent > 2.0) && (s.price > s.sma_20)).sort((a, b) => (b.percent || 0) - (a.percent || 0)).slice(0, 10),
        emptyMsg: 'لا توجد اختراقات قوية اليوم'
    },
    'overbought': {
        title: 'تضخم شرائي (حذر) ⚠️',
        desc: 'مؤشر RSI فوق 70. المنطقة تتطلب الحذر من جني الأرباح.',
        filter: (data) => data.filter(s => s.rsi_14 && s.rsi_14 > 70).sort((a, b) => (b.rsi_14 || 0) - (a.rsi_14 || 0)).slice(0, 10),
        emptyMsg: 'السوق صحي (لا يوجد تضخم شرائي)'
    },
    'bullish_div': {
        title: 'دايفرجنس إيجابي (استباقي) 🟢',
        desc: 'السعر يسجل قاعاً جديداً بينما المؤشر يسجل قاعاً صاعداً، ما ينبئ بقرب الانعكاس.',
        filter: (data) => data.filter(s => s.strategy_bullish_div === true).sort((a, b) => (b.percent || 0) - (a.percent || 0)),
        emptyMsg: 'لا يوجد دايفرجنس مكتمل الشروط حالياً'
    },
    'vwap_bounce': {
        title: 'ارتكاز VWAP (سيولة ذكية) 🎯',
        desc: 'تراجع السعر لمللامسة متوسط VWAP مع شمعة عاكسة وسيولة عالية.',
        filter: (data) => data.filter(s => s.strategy_vwap_bounce === true).sort((a, b) => (b.volume || 0) - (a.volume || 0)),
        emptyMsg: 'لا توجد فرص ارتكاز VWAP حالياً.<br><small style="opacity:0.7">الشروط: السعر > VWAP، ملامسة للخط، شمعة عاكسة، سيولة عالية.</small>'
    },
    'morning_star': {
        title: 'نموذج الصباح (انعكاس) 🌅',
        desc: 'نموذج شموع انعكاسي يتكون عند القيعان ويدعمه الفوليوم.',
        filter: (data) => data.filter(s => s.strategy_morning_star === true).sort((a, b) => (b.percent || 0) - (a.percent || 0)),
        emptyMsg: 'لا يوجد نموذج صباح مكتمل حالياً.<br><small style="opacity:0.7">الشروط: شمعة هابطة > نجمة > شمعة صاعدة + دعم فني.</small>'
    },
    'donchian_breakout': {
        title: 'اختراق قناة دونشيان (اتجاه صاعد) 📈',
        desc: 'اختراق السعر لأعلى قمة في 20 يوم مع سيولة > 150% وفوق متوسط 50 يوم.',
        filter: (data) => data.filter(s => s.strategy_donchian_breakout === true).sort((a, b) => (b.percent || 0) - (a.percent || 0)),
        render: renderDonchianTable // Custom render function
    },
};


document.addEventListener('DOMContentLoaded', async () => {
    // 1. Init Chart (Independently)
    try {
        initChart();
    } catch (chartErr) {
        console.error("Chart Init Error:", chartErr);
    }

    // 2. Load Data
    try {
        // Ensure Firebase is initialized
        if (!firebase.apps.length) {
            console.log("Firebase not initialized in DOMContentLoaded, initializing now...");
            firebase.initializeApp(firebaseConfig);
        }

        const db = firebase.firestore();
        console.log("Fetching Analysis Data...");

        const snapshot = await db.collection('stocks').get();
        allStocksData = [];
        snapshot.forEach(doc => {
            allStocksData.push(doc.data());
        });

        // Find TASI for Header
        const tasi = allStocksData.find(s => s.symbol === 'TASI' || s.name === 'TASI' || s.symbol === 'tasi');
        if (tasi) {
            const priceEl = document.getElementById('header-tasi-price');
            const changeEl = document.getElementById('header-tasi-change');

            if (priceEl && changeEl) {
                // Ensure values exist
                const p = tasi.price || 0;
                const c = tasi.change || 0;
                const pct = tasi.percent || 0;

                priceEl.innerText = p.toFixed(2);
                changeEl.innerText = `${c > 0 ? '+' : ''}${c.toFixed(2)} (${pct.toFixed(2)}%)`;
                const colorVar = c >= 0 ? 'var(--up-color)' : 'var(--down-color)';
                priceEl.style.color = colorVar;
                changeEl.style.color = colorVar;
            }
        }

        // Initial Render
        updateView('gainers');

        // Listener for Buttons
        const buttons = document.querySelectorAll('.filter-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                // Remove active from all
                buttons.forEach(b => b.classList.remove('active'));
                // Add to clicked
                btn.classList.add('active');

                // Update View
                updateView(btn.getAttribute('data-mode'));
            });
        });

    } catch (e) {
        console.error("Error loading analysis data:", e);
        // Alert User
        alert("حدث خطأ في تحميل البيانات: " + e.message);
        document.getElementById('analysis-table-body').innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">حدث خطأ في تحميل البيانات.<br><small>' + e.message + '</small></td></tr>';
    }
});

let currentMode = 'gainers'; // Track global mode

function updateView(mode) {
    currentMode = mode; // Update mode
    const tableBody = document.getElementById('analysis-table-body');
    if (!tableBody) return;

    const strategy = STRATEGIES[mode];
    if (!strategy) {
        console.warn(`Strategy ${mode} not found.`);
        return;
    }

    // 1. Filter Data
    let sortedList = strategy.filter(allStocksData);

    // 2. Update Info Box
    updateStrategyInfo(mode, sortedList);

    // 3. Render Table
    if (strategy.render) {
        strategy.render(sortedList);
    } else {
        if (sortedList.length === 0) {
            const msg = strategy.emptyMsg || 'لا توجد بيانات مطابقة لهذه الاستراتيجية حالياً.';
            tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 20px;">${msg}</td></tr>`;
        } else {
            renderTable(sortedList);
        }
    }
}

function updateStrategyInfo(mode, list) {
    const infoBox = document.getElementById('strategyInfo');
    const titleEl = document.getElementById('strategyTitle');
    const descEl = document.getElementById('strategyDesc');
    const updateEl = document.getElementById('lastUpdate');
    const matchEl = document.getElementById('matchCount');
    const unmatchEl = document.getElementById('unmatchCount');

    if (!infoBox) return;
    infoBox.style.display = 'block';

    const strategy = STRATEGIES[mode] || { title: mode, desc: 'تحليل فني للسهم.' };

    titleEl.textContent = strategy.title;
    descEl.textContent = strategy.desc;

    // Stats
    const matched = list.length;
    matchEl.textContent = matched;

    // Show Scanned Count clearly
    if (unmatchEl && unmatchEl.parentElement) {
        unmatchEl.parentElement.style.display = 'inline';
        unmatchEl.parentElement.innerHTML = `<span style="color: #666;">تم فحص: <span style="color: #ccc;">${allStocksData.length}</span></span>`;
    }

    // Last Update: Find the MOST RECENT update time among all loaded data
    let maxDate = null;
    if (allStocksData.length > 0) {
        allStocksData.forEach(s => {
            if (s.lastUpdated) {
                const d = s.lastUpdated.toDate ? s.lastUpdated.toDate() : new Date(s.lastUpdated);
                if (!maxDate || d > maxDate) maxDate = d;
            }
        });
    }

    if (maxDate) {
        updateEl.textContent = maxDate.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) + ' ' + maxDate.toLocaleDateString('ar-SA');
    } else {
        updateEl.textContent = '-';
    }
}

function renderTable(list) {
    const tableBody = document.getElementById('analysis-table-body');

    // Restore Default Headers
    const thead = document.querySelector('.data-table thead tr');
    if (thead) {
        thead.innerHTML = `
            <th style="padding: 8px; text-align: right; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-weight: 500;">الشركة</th>
            <th style="padding: 8px; text-align: left; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-weight: 500;">آخر سعر</th>
            <th style="padding: 8px; text-align: left; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-weight: 500;">التغير %</th>
            <th style="padding: 8px; text-align: left; border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-weight: 500;">قيمة التغير</th>
        `;
    }

    tableBody.innerHTML = '';

    list.forEach(stock => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer'; // Make clickable
        tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';

        // Add CLick Event
        tr.onclick = () => {
            // Highlight row
            document.querySelectorAll('#analysis-table-body tr').forEach(r => r.style.background = 'transparent');
            tr.style.background = 'rgba(255, 255, 255, 0.05)';
            loadChartForSymbol(stock.symbol, stock.name, currentMode);
        };

        const changeClass = (stock.percent >= 0) ? 'text-up' : 'text-down';
        const sign = (stock.percent > 0) ? '+' : '';
        const price = stock.price !== undefined ? stock.price.toFixed(2) : '-';
        const change = stock.change !== undefined ? stock.change.toFixed(2) : '-';

        tr.innerHTML = `
            <td style="padding: 12px; text-align: right;">
                <div style="font-weight: 500; color: #fff;">${stock.name || stock.symbol}</div>
                <div style="font-size: 11px; opacity: 0.6;">${stock.symbol}</div>
            </td>
            <td style="padding: 12px;" class="font-mono">${price}</td>
            <td style="padding: 12px;" class="font-mono ${changeClass}">
                <span dir="ltr">${sign}${stock.percent ? stock.percent.toFixed(2) : '0.00'}%</span>
            </td>
             <td style="padding: 12px;" class="font-mono ${changeClass}">
                ${stock.change ? stock.change.toFixed(2) : '0.00'}
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

function renderDonchianTable(list) {
    const tableBody = document.getElementById('analysis-table-body');
    // Update Header for this mode
    const thead = document.querySelector('.data-table thead tr');
    if (thead) {
        thead.innerHTML = `
            <th style="padding: 8px; text-align: right; border-bottom: 1px solid var(--border-color); color: var(--text-muted);">الشركة</th>
            <th style="padding: 8px; text-align: left; border-bottom: 1px solid var(--border-color); color: var(--text-muted);">سعر الدخول</th>
            <th style="padding: 8px; text-align: left; border-bottom: 1px solid var(--border-color); color: var(--text-muted);">وقف الخسارة</th>
            <th style="padding: 8px; text-align: left; border-bottom: 1px solid var(--border-color); color: var(--text-muted);">التغير %</th>
        `;
    }

    tableBody.innerHTML = '';

    if (list.length === 0) {
        const msg = STRATEGIES['donchian_breakout'].emptyMsg || 'لا توجد بيانات.';
        tableBody.innerHTML = `
            <tr><td colspan="4" style="text-align:center; padding: 20px;">
                ${msg}
            </td></tr>`;
        return;
    }

    list.forEach(stock => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';

        // Add CLick Event
        tr.onclick = () => {
            // Highlight row
            document.querySelectorAll('#analysis-table-body tr').forEach(r => r.style.background = 'transparent');
            tr.style.background = 'rgba(255, 255, 255, 0.05)';
            loadChartForSymbol(stock.symbol, stock.name, currentMode);
        };

        const changeClass = (stock.percent >= 0) ? 'text-up' : 'text-down';
        const sign = (stock.percent > 0) ? '+' : '';

        // Use strategy values if available, else fallback
        const entry = stock.donchian_entry ? stock.donchian_entry.toFixed(2) : (stock.price ? stock.price.toFixed(2) : '-');
        const stop = stock.donchian_stop_loss ? stock.donchian_stop_loss.toFixed(2) : '-';

        tr.innerHTML = `
            <td style="padding: 12px; text-align: right;">
                <div style="font-weight: 500; color: #fff;">${stock.name || stock.symbol}</div>
                <div style="font-size: 11px; opacity: 0.6;">${stock.symbol}</div>
            </td>
            <td style="padding: 12px; color: #4caf50;" class="font-mono">${entry}</td>
            <td style="padding: 12px; color: #f44336;" class="font-mono">${stop}</td>
             <td style="padding: 12px;" class="font-mono ${changeClass}">
                <span dir="ltr">${sign}${stock.percent ? stock.percent.toFixed(2) : '0.00'}%</span>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}
