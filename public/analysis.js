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

let allStocksData = [];

document.addEventListener('DOMContentLoaded', async () => {
    try {
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
                priceEl.innerText = tasi.price.toFixed(2);
                changeEl.innerText = `${tasi.change > 0 ? '+' : ''}${tasi.change.toFixed(2)} (${tasi.percent.toFixed(2)}%)`;
                const colorVar = tasi.change >= 0 ? 'var(--up-color)' : 'var(--down-color)';
                priceEl.style.color = colorVar;
                changeEl.style.color = colorVar;
            }
        }

        // Initial Render (Matches Default Value 'gainers')
        updateView('gainers');

        // Listener
        const selector = document.getElementById('analysis-selector');
        if (selector) {
            selector.addEventListener('change', (e) => {
                updateView(e.target.value);
            });
        }

    } catch (e) {
        console.error("Error loading analysis data:", e);
        document.getElementById('analysis-table-body').innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">Error loading data.</td></tr>';
    }
});

function updateView(mode) {
    const tableBody = document.getElementById('analysis-table-body');
    const titleEl = document.getElementById('table-title');

    if (!tableBody) return;

    let sortedList = [];

    // Logic
    if (mode === 'gainers') {
        titleEl.textContent = 'الأكثر ارتفاعاً 🚀';
        sortedList = [...allStocksData].sort((a, b) => (b.percent || 0) - (a.percent || 0)).slice(0, 20); // Top 20
    } else if (mode === 'losers') {
        titleEl.textContent = 'الأكثر انخفاضاً 🔻';
        sortedList = [...allStocksData].sort((a, b) => (a.percent || 0) - (b.percent || 0)).slice(0, 20); // Bottom 20
    } else if (mode === 'volume') {
        titleEl.textContent = 'الأعلى سيولة 💰 (مقدرة)';
        sortedList = [...allStocksData].filter(s => s.volume).sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 20);
        if (sortedList.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">بيانات السيولة غير متوفرة حالياً</td></tr>';
            return;
        }
    } else if (mode === 'speculative') {
        titleEl.textContent = 'فرص مضاربية (ذهبية) ✨';
        // Strategy: RSI 50-70 + Price > SMA20 + MACD > Signal
        // Note: Needs valid backend data.
        sortedList = allStocksData.filter(s => {
            if (!s.rsi_14 || !s.sma_20) return false;
            const rsiOk = s.rsi_14 >= 50 && s.rsi_14 <= 70;
            const trendOk = s.price > s.sma_20;
            const macdOk = s.macd > s.macd_signal; // Bullish Momentum
            return rsiOk && trendOk && macdOk;
        }).sort((a, b) => (b.percent || 0) - (a.percent || 0)).slice(0, 10);

        if (sortedList.length === 0) {
            sortedList = []; // Show empty or could show strict failures
            tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">لا توجد فرص مطابقة للشروط حالياً (تحتاج تحديث البيانات)</td></tr>';
            return;
        }
    } else if (mode === 'oversold') {
        titleEl.textContent = 'ارتداد من القاع (تشبع بيعي) 📉';
        // Strategy: RSI < 30
        sortedList = allStocksData.filter(s => {
            return s.rsi_14 && s.rsi_14 < 30;
        }).sort((a, b) => (a.rsi_14 || 0) - (b.rsi_14 || 0)).slice(0, 10);

        if (sortedList.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">لا توجد أسهم في منطقة تشبع بيعي حالياً</td></tr>';
            return;
        }
    } else if (mode === 'reversal') {
        titleEl.textContent = 'بداية انعكاس إيجابي 🔄';
        // Strategy: MACD > Signal (Crossover) + RSI < 50 (Early entry, not yet overbought)
        sortedList = allStocksData.filter(s => {
            if (!s.macd || !s.macd_signal) return false;
            return (s.macd > s.macd_signal) && (s.rsi_14 && s.rsi_14 < 60);
        }).sort((a, b) => (b.macd_hist || 0) - (a.macd_hist || 0)).slice(0, 10);

        if (sortedList.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">لا توجد إشارات انعكاس واضحة حالياً</td></tr>';
            return;
        }

    } else if (mode === 'breakout') {
        titleEl.textContent = 'اختراق قوي (سيولة) 💥';
        // Strategy: Change > 2% + Price > SMA20
        sortedList = allStocksData.filter(s => {
            return (s.percent > 2.0) && (s.price > s.sma_20);
        }).sort((a, b) => (b.percent || 0) - (a.percent || 0)).slice(0, 10);

        if (sortedList.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">لا توجد اختراقات قوية اليوم</td></tr>';
            return;
        }

    } else if (mode === 'overbought') {
        titleEl.textContent = 'تضخم شرائي (حذر) ⚠️';
        // Strategy: RSI > 70
        sortedList = allStocksData.filter(s => {
            return s.rsi_14 && s.rsi_14 > 70;
        }).sort((a, b) => (b.rsi_14 || 0) - (a.rsi_14 || 0)).slice(0, 10);

        if (sortedList.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">السوق صحي (لا يوجد تضخم شرائي)</td></tr>';
            return;
        }
    }

    renderTable(sortedList);
}

function renderTable(list) {
    const tableBody = document.getElementById('analysis-table-body');
    tableBody.innerHTML = '';

    list.forEach(stock => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';

        const changeClass = (stock.percent >= 0) ? 'val-up' : 'val-down';
        const sign = (stock.percent > 0) ? '+' : '';
        const price = stock.price !== undefined ? stock.price.toFixed(2) : '-';
        const change = stock.change !== undefined ? stock.change.toFixed(2) : '-';

        tr.innerHTML = `
            <td style="padding: 12px; text-align: right;">
                <div style="font-weight: 500; color: #fff;">${stock.name || stock.symbol}</div>
                <div style="font-size: 11px; opacity: 0.6;">${stock.symbol}</div>
            </td>
            <td style="padding: 12px; font-family: 'JetBrains Mono';">${price}</td>
            <td style="padding: 12px; font-family: 'JetBrains Mono';" class="${changeClass}">
                <span dir="ltr">${sign}${stock.percent ? stock.percent.toFixed(2) : '0.00'}%</span>
            </td>
             <td style="padding: 12px; font-family: 'JetBrains Mono';" class="${changeClass}">
                ${stock.change ? stock.change.toFixed(2) : '0.00'}
            </td>
        `;
        tableBody.appendChild(tr);
    });
}
