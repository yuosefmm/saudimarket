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
    // 1. Fetch TASI for Header
    fetchTASI();

    // 2. Fetch News
    fetchNews();

    // 3. Update Button
    const btnUpdate = document.getElementById('btn-update-news');
    if (btnUpdate) {
        btnUpdate.addEventListener('click', async () => {
            if (confirm('هل تريد تحديث أخبار اليوم من المصدر؟\n(يتطلب تشغيل server.py)')) {
                try {
                    showToast('جاري الاتصال بالخادم...');
                    const res = await fetch('http://localhost:5000/api/update-news?today=true', { method: 'POST' });
                    if (res.ok) {
                        showToast('✅ تم بدء التحديث');
                        // Refresh view after a delay
                        setTimeout(fetchNews, 5000);
                    } else {
                        showToast('❌ خطأ في الخادم');
                    }
                } catch (e) {
                    console.error(e);
                    showToast('⚠️ فشل الاتصال بالخادم');
                }
            }
        });
    }
});

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

async function fetchTASI() {
    try {
        const db = firebase.firestore();
        const doc = await db.collection('stocks').document('TASI').get();

        if (doc.exists) {
            const tasi = doc.data();
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
    } catch (e) {
        console.error("Error fetching TASI:", e);
    }
}

async function fetchNews() {
    const container = document.getElementById('news-list');
    try {
        const db = firebase.firestore();
        // Fetch latest 20 news items
        const snapshot = await db.collection('news').orderBy('published', 'desc').limit(20).get();

        if (snapshot.empty) {
            container.innerHTML = `
                <div style="text-align: center; color: var(--text-muted); padding-top: 50px;">
                    لا توجد أخبار حالياً.
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        snapshot.forEach(doc => {
            const item = doc.data();
            renderNewsItem(container, item);
        });

    } catch (e) {
        console.error("Error fetching news:", e);
        container.innerHTML = `
            <div style="text-align: center; color: var(--down-color); padding-top: 50px;">
                حدث خطأ أثناء تحميل الأخبار.
            </div>
        `;
    }
}

function renderNewsItem(container, item) {
    // Basic Sanitation
    const title = item.title || 'عنوان غير متوفر';
    const link = item.link || '#';
    const publisher = item.publisher || 'Yahoo Finance';
    const timeStr = item.published ? new Date(item.published.seconds * 1000).toLocaleString('ar-SA') : '';

    const div = document.createElement('div');
    div.className = 'news-card';
    div.innerHTML = `
        <a href="${link}" target="_blank" class="news-title">${title}</a>
        <div class="news-meta">
            <span>📰 ${publisher}</span>
            <span>🕒 ${timeStr}</span>
        </div>
    `;

    container.appendChild(div);
}
