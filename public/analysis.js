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
        document.getElementById('analysis-table-body').innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">Error loading data.</td></tr>';
    }
});

function updateView(mode) {
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
    // Use custom render if defined, otherwise default
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
        tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';

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
        // Reuse default empty check logic, but if this function is called directly...
        // But logic in updateView handles emptyMsg generally. 
        // However, updateView calls this even if list is empty if we want custom table.
        // Let's keep it consistent.
        const msg = STRATEGIES['donchian_breakout'].emptyMsg || 'لا توجد بيانات.';
        tableBody.innerHTML = `
            <tr><td colspan="4" style="text-align:center; padding: 20px;">
                ${msg}
            </td></tr>`;
        return;
    }

    list.forEach(stock => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';

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
