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

// ... Wait, I'll defer writing full content until I peek at app.js config block.
// But mostly I can just use `firebase.firestore()` if already initialized? 
// No, each page reload clears state.
// Let's assume I need to copy the config.

console.log("Analysis Page Loaded");

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Look for Config in app.js (Placeholder)
        // For now, let's assume we can just fetch.

        const db = firebase.firestore();

        // Fetch All Stocks
        const snapshot = await db.collection('stocks').get();
        const stocks = [];
        snapshot.forEach(doc => {
            stocks.push(doc.data());
        });

        // Process Data
        processGainers(stocks);
        processLosers(stocks);
        processVolume(stocks);

    } catch (e) {
        console.error("Error loading analysis data:", e);
        // Maybe config missing
        document.getElementById('gainers-list').innerHTML = '<li class="stock-item">Error loading data. Config missing?</li>';
    }
});

function processGainers(stocks) {
    // Sort by percent desc
    const sorted = [...stocks].sort((a, b) => (b.percent || 0) - (a.percent || 0));
    const top5 = sorted.slice(0, 5);
    renderList('gainers-list', top5);
}

function processLosers(stocks) {
    // Sort by percent asc
    const sorted = [...stocks].sort((a, b) => (a.percent || 0) - (b.percent || 0));
    const bottom5 = sorted.slice(0, 5);
    renderList('losers-list', bottom5);
}

function processVolume(stocks) {
    // Sort by volume? We might not have 'volume' in the stock header document?
    // In update_tasi.py we update 'price', 'change', 'percent', 'year_high', 'year_low'.
    // We DO NOT seem to update 'volume' in the header document in update_tasi.py?
    // Let's check update_tasi.py again.
    // Line 73: update_data = { price, change, percent, ... }
    // NO VOLUME.
    // We can't do Volume Leaderboard yet without modifying update script.
    // So I'll put "Not Available" or try validation.

    // Temporary: Use Price as proxy? No.
    // Render empty.
    document.getElementById('volume-list').innerHTML = '<li class="stock-item">Not available (Data Pending)</li>';
}

function renderList(elementId, list) {
    const container = document.getElementById(elementId);
    container.innerHTML = '';

    list.forEach(stock => {
        const li = document.createElement('li');
        li.className = 'stock-item';

        const changeClass = (stock.percent >= 0) ? 'val-up' : 'val-down';
        const sign = (stock.percent > 0) ? '+' : '';

        li.innerHTML = `
            <span class="stock-name">${stock.name || stock.symbol} <span style="font-size: 0.8em; opacity: 0.7;">(${stock.symbol})</span></span>
            <span class="stock-price ${changeClass}" style="direction: ltr;">
                ${sign}${stock.percent ? stock.percent.toFixed(2) : '0.00'}%
            </span>
        `;
        container.appendChild(li);
    });
}
