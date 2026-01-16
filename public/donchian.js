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

document.addEventListener('DOMContentLoaded', async () => {
    // A. Setup Update Button
    const btnUpdate = document.getElementById('btn-run-update');
    if (btnUpdate) {
        btnUpdate.addEventListener('click', async () => {
            if (!confirm('هل تريد بدء تحديث البيانات؟ (قد يستغرق عدة دقائق)')) return;

            try {
                btnUpdate.disabled = true;
                btnUpdate.innerText = "جاري البدء...";

                // Assuming local server is running on 5000
                const res = await fetch('http://localhost:5000/api/update-market?days=1', { method: 'POST' });
                const json = await res.json();

                alert(`✅ تم بدء التحديث!\n${json.message}\nتابع نافذة السيرفر لرؤية التقدم.`);
            } catch (err) {
                console.error(err);
                alert("❌ فشل الاتصال بالسيرفر المحلي (Local Server).\nتأكد من تشغيل 'python server.py'");
            } finally {
                btnUpdate.disabled = false;
                btnUpdate.innerText = "🔄 تحديث البيانات";
            }
        });
    }

    try {
        const db = firebase.firestore();
        console.log("Fetching Stocks for Donchian Strategy...");

        // Fetch all stocks (or we could query where strategy_donchian_breakout == true index)
        // Since dataset is small (~300), client-side filtering is fine and robust.
        const snapshot = await db.collection('stocks').get();

        let matches = [];
        let lastUpdateTime = null;

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.strategy_donchian_breakout === true) {
                matches.push(data);

                // Track latest update time
                if (data.lastUpdated) {
                    const t = data.lastUpdated.toDate ? data.lastUpdated.toDate() : new Date(data.lastUpdated);
                    if (!lastUpdateTime || t > lastUpdateTime) {
                        lastUpdateTime = t;
                    }
                }
            }
        });

        // Sort by Percent Change descending
        matches.sort((a, b) => (b.percent || 0) - (a.percent || 0));

        renderTable(matches);
        updateHeaderStats(matches.length, lastUpdateTime);

    } catch (e) {
        console.error("Error loading data:", e);
        document.getElementById('donchian-table-body').innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: #f44336;">حدث خطأ في تحميل البيانات.</td></tr>';
    }
});

function renderTable(list) {
    const tableBody = document.getElementById('donchian-table-body');
    tableBody.innerHTML = '';

    if (list.length === 0) {
        tableBody.innerHTML = `
            <tr><td colspan="6" style="text-align:center; padding: 40px;">
                <div style="font-size: 1.5rem; margin-bottom: 10px;">📭</div>
                <div>لا توجد فرص مطابقة حالياً</div>
                <div style="font-size: 0.8rem; opacity: 0.6; margin-top: 5px;">تأكد من تحديث البيانات مؤخراً</div>
            </td></tr>`;
        return;
    }

    list.forEach(stock => {
        const tr = document.createElement('tr');

        const changeClass = (stock.percent >= 0) ? 'val-up' : 'val-down'; // In CSS usually defined global or inline
        const changeStyle = (stock.percent >= 0) ? 'color: #4caf50;' : 'color: #f44336;';
        const sign = (stock.percent > 0) ? '+' : '';

        // Formats
        const entry = stock.donchian_entry ? stock.donchian_entry.toFixed(2) : '-';
        const stop = stock.donchian_stop_loss ? stock.donchian_stop_loss.toFixed(2) : '-';
        const price = stock.price ? stock.price.toFixed(2) : '-';
        const change = stock.percent ? stock.percent.toFixed(2) + '%' : '0.00%';
        const vol = stock.volume ? stock.volume.toLocaleString() : '-';

        tr.innerHTML = `
            <td>
                <div style="font-weight: bold; color: #fff;">${stock.name || stock.symbol}</div>
                <div style="font-size: 0.8rem; opacity: 0.6;">${stock.symbol}</div>
            </td>
            <td class="col-entry price-val" style="text-align: left;">${entry}</td>
            <td class="col-stop price-val" style="text-align: left;">${stop}</td>
            <td class="price-val" style="text-align: left;">${price}</td>
            <td class="price-val" style="text-align: left; ${changeStyle}" dir="ltr">${sign}${change}</td>
            <td class="price-val" style="text-align: left;">${vol}</td>
        `;

        tableBody.appendChild(tr);
    });
}

function updateHeaderStats(count, dateObj) {
    const badge = document.getElementById('match-count-badge');
    const timeEl = document.getElementById('last-update-time');

    if (badge) badge.innerText = `${count} فرص`;

    if (timeEl) {
        if (dateObj) {
            timeEl.innerText = dateObj.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) + ' ' + dateObj.toLocaleDateString('ar-SA');
        } else {
            timeEl.innerText = '-';
        }
    }
}
