/**
 * Shared Chart Utilities
 * Centralizes data fetching, processing, and indicator calculations.
 */

// Global Config
const CHART_CONFIG = {
    upColor: '#10b981',
    downColor: '#ef4444',
    borderVisible: false,
    wickUpColor: '#10b981',
    wickDownColor: '#ef4444',
};

/**
 * Fetches stock history from static JSON files.
 * @param {string} symbol - Stock symbol (e.g., '1120', 'TASI')
 * @param {string} resolution - '1D', '1m', '15m', '30m'
 * @returns {Promise<Array>} Raw JSON data
 */
async function fetchStockHistory(symbol, resolution = '1D') {
    let url = `/data/${symbol}.json?v=${Date.now()}`;

    // Intraday path logic
    if (resolution !== '1D' && ['1m', '15m', '30m'].includes(resolution)) {
        url = `/data/intraday/${resolution}/${symbol}.json?v=${Date.now()}`;
    }

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Chart data not found for ${symbol} (${resolution})`);
    }
    return await response.json();
}

/**
 * Processes raw JSON into Lightweight Charts format.
 * Calculates basic indicators (SMA, BB, RSI, MACD).
 * @param {Array} jsonHistory - Raw data from fetch
 * @returns {Object} { candles, volume, sma, bbUpper, bbLower, rsi, macd, macdSignal, macdHist }
 */
function processStockData(jsonHistory) {
    // 1. Deduplicate & Parse Time
    const uniqueData = new Map();

    jsonHistory.forEach(item => {
        let timeSeconds = 0;

        if (item.time && typeof item.time === 'number') {
            timeSeconds = item.time;
        } else if (item.date || item.time) {
            // String parsing (Daily)
            const rawTime = item.date || item.time;
            let dateStr = rawTime;
            if (rawTime.includes('T')) dateStr = rawTime.split('T')[0];
            if (dateStr.length !== 10) return;

            const parts = dateStr.split('-');
            const year = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            const day = parseInt(parts[2], 10);

            const dateObj = new Date(year, month, day, 12, 0, 0);
            timeSeconds = Math.floor(dateObj.getTime() / 1000);
        } else {
            return;
        }

        const openVal = parseFloat(item.open);
        const highVal = parseFloat(item.high);
        const lowVal = parseFloat(item.low);
        const closeVal = parseFloat(item.close);
        const volVal = parseFloat(item.volume);

        if (isNaN(openVal) || isNaN(highVal) || isNaN(lowVal) || isNaN(closeVal)) return;

        uniqueData.set(timeSeconds, {
            time: timeSeconds,
            open: openVal,
            high: highVal,
            low: lowVal,
            close: closeVal,
            volume: isNaN(volVal) ? 0 : volVal
        });
    });

    // 2. Sort by Date
    const sortedRecords = Array.from(uniqueData.values()).sort((a, b) => a.time - b.time);

    const data = {
        candles: [],
        volume: [],
        sma: [],
        bbUpper: [],
        bbLower: [],
        rsi: [],
        macd: [],
        macdSignal: [],
        macdHist: []
    };

    data.candles = sortedRecords.map(r => ({
        time: r.time,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close
    }));

    data.volume = sortedRecords.map(r => ({
        time: r.time,
        value: r.volume,
        color: (r.close >= r.open) ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)'
    }));

    // 3. Calculate Indicators
    const closePrices = data.candles.map(c => c.close);

    // SMA 20 & BB
    let historyClose = [];
    data.candles.forEach((c, i) => {
        historyClose.push(c.close);
        if (historyClose.length > 20) historyClose.shift();

        if (historyClose.length >= 20) {
            const sum = historyClose.reduce((a, b) => a + b, 0);
            const avg = sum / 20;
            data.sma.push({ time: c.time, value: avg });

            const sqDiffs = historyClose.map(val => Math.pow(val - avg, 2));
            const sd = Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / 20);

            data.bbUpper.push({ time: c.time, value: avg + (2 * sd) });
            data.bbLower.push({ time: c.time, value: avg - (2 * sd) });
        }
    });

    // RSI
    const rsiVals = calculateSimpleRSI(closePrices, 14);
    data.candles.forEach((c, i) => {
        const val = rsiVals[i];
        if (val !== null) data.rsi.push({ time: c.time, value: val });
    });

    // MACD
    const macdVals = calculateSimpleMACD(closePrices);
    data.candles.forEach((c, i) => {
        if (macdVals.macd[i] !== null) {
            data.macd.push({ time: c.time, value: macdVals.macd[i] });
            data.macdSignal.push({ time: c.time, value: macdVals.signal[i] });
            const h = macdVals.hist[i];
            data.macdHist.push({
                time: c.time,
                value: h,
                color: h >= 0 ? '#26a69a' : '#ef4444'
            });
        }
    });

    return data;
}

// --- Indicator Algos (Simplified for shared use) ---

function calculateSimpleRSI(prices, period = 14) {
    if (prices.length < period) return new Array(prices.length).fill(null);

    const result = new Array(prices.length).fill(null);
    let gains = 0;
    let losses = 0;

    // First Avg
    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    let rs = avgGain / avgLoss;
    let rsi = 100 - (100 / (1 + rs));
    if (avgLoss === 0) rsi = 100;

    result[period] = rsi; // First valid point at index 'period'

    // Rest
    for (let i = period + 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        let gain = change > 0 ? change : 0;
        let loss = change < 0 ? Math.abs(change) : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;

        rs = avgGain / avgLoss;
        rsi = 100 - (100 / (1 + rs));
        if (avgLoss === 0) rsi = 100;

        result[i] = rsi;
    }
    return result;
}

function calculateSimpleMACD(prices) {
    // 12, 26, 9
    const ema12 = calculateEMAArray(prices, 12);
    const ema26 = calculateEMAArray(prices, 26);

    const macdLine = [];
    const signalLine = [];
    const hist = [];

    for (let i = 0; i < prices.length; i++) {
        if (ema12[i] !== null && ema26[i] !== null) {
            macdLine.push(ema12[i] - ema26[i]);
        } else {
            macdLine.push(null);
        }
    }

    // Signal is EMA9 of MACD Line
    // We need to handle the nulls at start of MACD
    // Find first non-null index
    let firstValid = macdLine.findIndex(x => x !== null);
    if (firstValid === -1) return { macd: macdLine, signal: [], hist: [] };

    // Create a sub-array for EMA calc
    const validMacd = macdLine.slice(firstValid);
    const validSignal = calculateEMAArray(validMacd, 9);

    // Pad signal with nulls
    for (let i = 0; i < firstValid; i++) signalLine.push(null);
    signalLine.push(...validSignal);

    // Hist
    for (let i = 0; i < prices.length; i++) {
        if (macdLine[i] !== null && signalLine[i] !== null) {
            hist.push(macdLine[i] - signalLine[i]);
        } else {
            hist.push(null);
        }
    }

    return { macd: macdLine, signal: signalLine, hist: hist };
}

function calculateEMAArray(data, period) {
    if (data.length < period) return new Array(data.length).fill(null);

    const k = 2 / (period + 1);
    const result = new Array(data.length).fill(null);

    // SMA for first
    let sum = 0;
    for (let i = 0; i < period; i++) sum += data[i];
    let ema = sum / period;

    result[period - 1] = ema;

    for (let i = period; i < data.length; i++) {
        ema = (data[i] * k) + (result[i - 1] * (1 - k));
        result[i] = ema;
    }
    return result;
}
