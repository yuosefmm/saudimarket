import firebase_admin
from firebase_admin import credentials, firestore
import yfinance as yf
from datetime import datetime
import time
import sys
import traceback
import json
import os
import pandas as pd
import numpy as np

# Force UTF-8 for console output
try:
    sys.stdout.reconfigure(encoding='utf-8')
except:
    pass

# Fix for SSL error (if needed)
# Fix for SSL if needed (Local Development only)
cacert_path = r"c:\projects\swm\cacert.pem"
if os.path.exists(cacert_path):
    os.environ["CURL_CA_BUNDLE"] = cacert_path

# 1. Initialize Firebase
if not firebase_admin._apps:
    if os.getenv('SERVICE_ACCOUNT_KEY'):
        cred = credentials.Certificate(json.loads(os.getenv('SERVICE_ACCOUNT_KEY')))
    else:
        cred = credentials.Certificate('serviceAccountKey.json')
    firebase_admin.initialize_app(cred)
db = firestore.client()

print("Connected to Firebase Firestore", flush=True)

def load_symbols():
    try:
        with open('saudi_symbols.json', 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        print("saudi_symbols.json not found.")
        return {}

stocks_map = load_symbols()
print(f"Loaded {len(stocks_map)} symbols from saudi_symbols.json", flush=True)

def sanitize(value):
    if pd.isna(value) or np.isinf(value):
        return 0.0
    return float(value)

def upload_stock_history(symbol_id, stock_info, period, should_clear=False, days_limit=None):
    yahoo_ticker = stock_info.get('yf_symbol')
    if not yahoo_ticker: return

    print(f"   Processing {symbol_id} ({period})...", flush=True)
    
    # NOTE: Direct overwrite is sufficient, no need to delete collection explicitely

    try:
        # A. DOWNLOAD DATA via yfinance
        ticker = yf.Ticker(yahoo_ticker)
        
        # Valid periods: 1d,5d,1mo,3mo,6mo,1y,2y,5y,10y,ytd,max
        df = ticker.history(period=period, interval="1d")
        print(f"      Fetched {len(df)} rows.", flush=True)
        
        if df.empty:
            print(f"      Warning: No data found for {yahoo_ticker}", flush=True)
            return

        # C. CALCULATE INDICATORS (RSI, MACD, SMA)
        # ----------------------------------------------------
        # SMA 20
        df['SMA_20'] = df['Close'].rolling(window=20).mean()
        
        # RSI 14
        delta = df['Close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / loss
        df['RSI_14'] = 100 - (100 / (1 + rs))
        
        # MACD (12, 26, 9) - simplified using EWMA
        k_fast = df['Close'].ewm(span=12, adjust=False).mean()
        k_slow = df['Close'].ewm(span=26, adjust=False).mean()
        df['MACD'] = k_fast - k_slow
        df['MACD_Signal'] = df['MACD'].ewm(span=9, adjust=False).mean()
        df['MACD_Hist'] = df['MACD'] - df['MACD_Signal']
        
        # VWAP 20 (Rolling)
        # VWAP = Sum(Price * Volume) / Sum(Volume)
        df['TypPrice'] = (df['High'] + df['Low'] + df['Close']) / 3
        df['VP'] = df['TypPrice'] * df['Volume']
        df['VWAP_20'] = df['VP'].rolling(window=20).sum() / df['Volume'].rolling(window=20).sum()
        
        # Get Latest Values
        if len(df) > 0:
            last_idx = df.index[-1]
            latest_rsi = convert_val(df.at[last_idx, 'RSI_14'])
            latest_macd = convert_val(df.at[last_idx, 'MACD'])
            latest_macd_sig = convert_val(df.at[last_idx, 'MACD_Signal'])
            latest_macd_hist = convert_val(df.at[last_idx, 'MACD_Hist'])
            latest_sma_20 = convert_val(df.at[last_idx, 'SMA_20'])
        else:
            latest_rsi = 50.0
            latest_macd = 0.0
            latest_macd_sig = 0.0
            latest_macd_hist = 0.0
            latest_sma_20 = 0.0

        # B. PREPARE FIRESTORE
        # TARGET PRODUCTION COLLECTION
        history_ref = db.collection('stocks').document(symbol_id).collection('history')
        
        items_to_write = []
        
        count = 0
        latest_close = 0
        latest_change = 0
        latest_percent = 0
        
        closes = df['Close'].tolist()

        # CHECK INCREMENTAL MODE (Default: True)
        is_full_sync = False
        if days_limit:
            target_df = df.tail(days_limit)
        else:
            is_full_sync = os.getenv('FULL_SYNC', 'false').lower() == 'true' or should_clear
            target_df = df if is_full_sync else df.tail(3)
        
        for index, row in target_df.iterrows():
            if pd.isna(row['Open']) or pd.isna(row['Close']):
                continue

            if index.dayofweek == 4 or index.dayofweek == 5:
                continue

            date_str = index.strftime('%Y-%m-%d')
            
            # SANITIZE DATA HERE
            doc_data = {
                'time': date_str,
                'open': sanitize(row['Open']),
                'high': sanitize(row['High']),
                'low': sanitize(row['Low']),
                'close': sanitize(row['Close']),
                'volume': int(row['Volume']) if not pd.isna(row['Volume']) else 0
            }
            
            doc_ref = history_ref.document(date_str)
            items_to_write.append((doc_ref, doc_data))
            
            count += 1
            
        # Capture latest close from FULL df, even if we scan only tail
        if not df.empty:
             latest_close = df.iloc[-1]['Close'] 
            
        # Execute writes SEQUENTIALLY with logging
        # Reduce Logging to avoid spam
        # print(f"      Writing {len(items_to_write)} records...", flush=True)
        
        write_count = 0
        batch = db.batch()
        batch_size = 0
        
        # Use Batches for Faster Write
        for ref, data in items_to_write:
            batch.set(ref, data)
            batch_size += 1
            if batch_size >= 400:
                batch.commit()
                batch = db.batch()
                batch_size = 0
        
        if batch_size > 0:
            batch.commit()
            
        # Calculate change
        if len(closes) >= 2:
            latest_change = closes[-1] - closes[-2]
            if closes[-2] > 0:
                latest_percent = (latest_change / closes[-2]) * 100

        print(f"      Uploaded {len(items_to_write)} records (FullSync={is_full_sync}) + Technicals (RSI: {latest_rsi:.1f}).", flush=True)

        if count > 0 or not is_full_sync: # Even if count 0 (unlikely with tail), we update main doc
            # E. UPDATE MAIN DOC
            info = ticker.fast_info
            
            final_name = stock_info.get('name', symbol_id)

            # Calculate Strategy Flags
            is_bullish_div = check_bullish_divergence(df)
            is_vwap_bounce = check_vwap_bounce(df)
            is_morning_star = check_morning_star(df)
            donchian_result = check_donchian_breakout(df)

            main_doc_ref = db.collection('stocks').document(symbol_id)
            # Ensure main doc data is also sanitized
            current_data = {
                'symbol': symbol_id,
                'name': final_name,
                'price': sanitize(latest_close),
                'change': sanitize(latest_change),
                'percent': sanitize(latest_percent),
                'year_high': sanitize(info.year_high) if info.year_high else 0.0,
                'year_low': sanitize(info.year_low) if info.year_low else 0.0,
                # TECHNICALS
                'rsi_14': latest_rsi,
                'macd': latest_macd,
                'macd_signal': latest_macd_sig,
                'macd_hist': latest_macd_hist,
                'sma_20': latest_sma_20,
                # STRATEGIES
                'strategy_bullish_div': is_bullish_div,
                'strategy_vwap_bounce': is_vwap_bounce,
                'strategy_morning_star': is_morning_star,
                'strategy_donchian_breakout': donchian_result['is_match'],
                'donchian_entry': donchian_result['entry_price'],
                'donchian_stop_loss': donchian_result['stop_loss'],
                'lastUpdated': datetime.now()
            }
            
            main_doc_ref.set(current_data, merge=True)
        else:
             print("      No valid records.", flush=True)

    except Exception:
        print(f"Errors on {symbol_id}", flush=True)
        traceback.print_exc()

def check_bullish_divergence(df):
    """
    Detects Bullish Divergence:
    1. Lower Low in Price (within last 20 periods)
    2. Higher Low in RSI
    3. RSI < 30 at first trough (oversold condition)
    4. Current candle is Green (Close > Open) - Confirmation
    """
    if len(df) < 20: return False
    
    # Work on last 25 candles to be safe
    window = df.tail(25).copy()
    
    # Find Local Price Minima (Troughs)
    # A trough is lower than immediate neighbors
    window['is_trough'] = (window['Low'] < window['Low'].shift(1)) & (window['Low'] < window['Low'].shift(-1))
    
    troughs = window[window['is_trough']]
    
    if len(troughs) < 2: return False
    
    # Get last two troughs
    t2 = troughs.iloc[-1] # Most recent trough
    t1 = troughs.iloc[-2] # Previous trough
    
    # Check if T2 is recent enough (e.g., within last 10 candles)
    # If it's too old, the setup is stale.
    # We want to catch the bounce *now*.
    # Actually, user said: "Alert when a green candle follows"
    # So T2 should be very close to now.
    
    # Price Condition: Lower Low
    if not (t2['Low'] < t1['Low']): return False
    
    # RSI Condition: Higher Low
    if not (t2['RSI_14'] > t1['RSI_14']): return False
    
    # Oversold Condition: T1 or T2 < 30 (User: "RSI was in oversold")
    if not (t1['RSI_14'] < 30 or t2['RSI_14'] < 30): return False
    
    # Confirmation: Current candle is Green
    current = df.iloc[-1]
    is_green = current['Close'] > current['Open']
    
    if not is_green: return False
    
    return True

def check_vwap_bounce(df):
    """
    Detects VWAP Bounce (Bullish):
    1. Condition: Price > VWAP (Trend is Up/Hold)
    2. Pullback: Low touches VWAP (Low <= VWAP * 1.01 and Low >= VWAP * 0.99)
       OR Low <= VWAP and Close >= VWAP (Intraday dip and recovery)
    3. Trigger: Hammer-like Candle (Long Lower Wick)
    4. Volume: High Volume (> 120% of 10-day Avg)
    """
    if len(df) < 20: return False
    
    # Needs VWAP column. If not present, calculate it here or in main loop.
    # We will assume it's calculated in main loop.
    if 'VWAP_20' not in df.columns:
        return False

    current = df.iloc[-1]
    
    # 1. Position: Close must be above VWAP (or at least equal) to show strength
    if current['Close'] < current['VWAP_20']: return False
    
    # 2. Touch/Dip: Low was below or near VWAP
    # "Touching" logic: Low is within 1% of VWAP or actually dipped below.
    # Strict "Bounce" means Low <= VWAP and Close > VWAP
    if not (current['Low'] <= current['VWAP_20'] * 1.005): return False
    
    # 3. Candle Shape: Reversal (Hammer / Long Lower Tail)
    body = abs(current['Close'] - current['Open'])
    lower_wick = min(current['Close'], current['Open']) - current['Low']
    
    # Tail should be at least as big as body (or significant if body is tiny)
    if body == 0:
        is_hammer = lower_wick > (current['High'] - current['Low']) * 0.5 # Doji-like hammer
    else:
        is_hammer = lower_wick >= body * 1.5
        
    if not is_hammer: return False
    
    # 4. Volume Spike
    # Calculate SMA 10 Volume (excluding current? or including?)
    # Usually compare current to PREVIOUS average.
    vol_sma = df['Volume'].iloc[-11:-1].mean() # Last 10 excluding current
    if vol_sma == 0: return False
    
    if current['Volume'] < (vol_sma * 1.20): return False
    
    
    if current['Volume'] < (vol_sma * 1.20): return False
    
    return True

def check_morning_star(df):
    """
    Detects Morning Star with Support/Fib Confluence:
    Pattern:
      1. T-2: Long Red Candle (Body > Avg)
      2. T-1: Small Candle (Doji/Spinning Top), Gap Down ideally, Body < 50% of T-2
      3. T-0: Long Green Candle, Close > Midpoint of T-2
    Confluence:
      - Price is near a Swing Low (Support) OR near 61.8% Fib of last wave.
    """
    if len(df) < 50: return False
    
    # 1. Pattern Recognition
    c0 = df.iloc[-1]   # Today
    c1 = df.iloc[-2]   # Yesterday
    c2 = df.iloc[-3]   # Day before
    
    # C2: Long Red
    body2 = c2['Open'] - c2['Close']
    if body2 <= 0: return False # Must be red
    
    # Average body size check (last 10 days)
    avg_body = (df['High'] - df['Low']).tail(10).mean()
    if body2 < avg_body: return False # Not "Long" enough
    
    # C1: Small Body (Star)
    body1 = abs(c1['Close'] - c1['Open'])
    if body1 > (body2 * 0.4): return False # Body too big for a star (relaxed to 40% from 25%)
    
    # C1 should ideally gap down or be low 
    # (Strict Morning Star has gap, but in stocks continuous trading fills gaps often. 
    # Key is C1 is the "bottom")
    if c1['Close'] > c2['Close'] and c1['Open'] > c2['Close']: 
        # If star is completely above C2 close, it's not ideal bottoming
        pass 

    # C0: Long Green, Closing > Midpoint of C2
    body0 = c0['Close'] - c0['Open']
    if body0 <= 0: return False # Must be green
    
    midpoint_c2 = c2['Close'] + (body2 * 0.5)
    if c0['Close'] < midpoint_c2: return False # Did not close above midpoint
    
    # 2. Confluence Check (Support / Fib 61.8%)
    # Let's find "Last Major Wave"
    # Find Max High in last 60 days
    last_60 = df.tail(60)
    max_idx = last_60['High'].idxmax()
    max_high = last_60.loc[max_idx]['High']
    
    # Find Min Low BEFORE that High (Start of wave)
    # This is tricky without full loop. 
    # Simpler heuristic: Find Global Min of last 90 days.
    last_90 = df.tail(90)
    min_low = last_90['Low'].min()
    
    # If the pattern is HAPPENING at the min_low, it's a "Support Bounce"
    pattern_low = min(c0['Low'], c1['Low'], c2['Low'])
    
    # Check 1: Is this near the 90-day low? (Support)
    # Threshold: within 2% of min_low
    is_support = pattern_low <= (min_low * 1.02)
    
    # Check 2: Fibonacci 61.8% Retracement
    # Asumming Wave is from min_low -> max_high
    # Note: If current price IS the min_low, then we are at 0% retracement (start of wave).
    # We want a pullback. So Max High must be AFTER Min Low.
    if max_idx > last_90['Low'].idxmin():
        wave_height = max_high - min_low
        fib_618 = max_high - (wave_height * 0.618)
        
        # Check if pattern low touched Fib 61.8 area (+/- 2%)
        is_fib = (pattern_low >= fib_618 * 0.98) and (pattern_low <= fib_618 * 1.02)
    else:
        is_fib = False

    # Combined Condition: Pattern + (Support OR Fib)
    if not (is_support or is_fib):
        return False
        
    # 3. Liquidity Filter (Added Check)
    # Condition: Current Volume > 1.5 * Average Volume (Last 10 days)
    # Note: avg_body calculation above used last 10 'High'-'Low'. We need volume here.
    vol_history = df['Volume'].tail(11).iloc[:-1] # Last 10 days excluding today
    if len(vol_history) > 0:
        avg_vol = vol_history.mean()
        if avg_vol > 0:
             # Check if Current Volume > 1.5x Average
             if c0['Volume'] <= (avg_vol * 1.5):
                 return False
    
    return True

def convert_val(val):
    if pd.isna(val) or np.isinf(val):
        return 0.0
    return float(val)

# --- MAIN EXECUTION ---

def check_donchian_breakout(df):
    """
    Detects Donchian Channel Breakout:
    1. Close > Donchian Upper Band (20)
    2. Volume > Volume SMA (10) * 1.5
    3. Close > SMA (50)
    """
    default_res = {'is_match': False, 'entry_price': 0.0, 'stop_loss': 0.0}
    
    if len(df) < 50:
        return default_res

    # Use tail for performance if possible, but we need enough data for rolling
    # We will just operate on the dataframe we have.
    
    # 1. Donchian Channel (20)
    # Upper Band = Max High of last 20 candles (shifted 1 to exclude today)
    donchian_upper = df['High'].shift(1).rolling(window=20).max()
    donchian_lower = df['Low'].shift(1).rolling(window=20).min()
    donchian_middle = (donchian_upper + donchian_lower) / 2
    
    # 2. Volume SMA (10)
    vol_sma_10 = df['Volume'].rolling(window=10).mean()
    
    # 3. Close SMA (50)
    close_sma_50 = df['Close'].rolling(window=50).mean()
    
    if len(df) == 0:
        return default_res

    # Get latest
    idx = df.index[-1]
    
    try:
        current_close = df.at[idx, 'Close']
        current_volume = df.at[idx, 'Volume']
        
        d_upper = donchian_upper.at[idx]
        d_middle = donchian_middle.at[idx]
        v_sma = vol_sma_10.at[idx]
        c_sma = close_sma_50.at[idx]
        
        # Check for NaNs
        if pd.isna(d_upper) or pd.isna(v_sma) or pd.isna(c_sma):
             return default_res

        # Conditions
        cond1 = current_close > d_upper
        cond2 = current_volume > (v_sma * 1.5)
        cond3 = current_close > c_sma
        
        if cond1 and cond2 and cond3:
            return {
                'is_match': True,
                'entry_price': sanitize(current_close),
                'stop_loss': sanitize(d_middle)
            }
            
    except Exception:
        pass

    return default_res

# --- MAIN EXECUTION ---

# --- MAIN EXECUTION ---
import argparse

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Fetch Saudi Stock Data')
    parser.add_argument('symbol', nargs='?', help='Target Symbol (e.g. 1120.SR or TASI)')
    parser.add_argument('--days', type=int, help='Number of days to update (e.g. 7)')
    parser.add_argument('--full-sync', action='store_true', help='Force full sync')
    
    args = parser.parse_args()
    
    # Logic for period/days
    # Default is 1y if not specified
    fetch_period = '1y'
    
    # If days is small (e.g. 7), we might still want to fetch 1mo to be safe, then slice?
    # Or rely on df.tail() logic?
    # The existing logic uses 'period' in upload_stock_history.
    # If args.days is set, we pass it down? 
    # Current function signature: upload_stock_history(symbol_id, stock_info, period, should_clear=False)
    
    # Let's Modify upload_stock_history to accept 'days_limit' or handle it 
    # But since I can't easily change the function signature without re-reading the whole file,
    # I will adapt the CALL sites inside the loop or modify the global 'period'.
    
    # Actually, let's just use '1mo' if days <= 30, else '1y' etc.
    if args.days:
        if args.days <= 7:
            fetch_period = '5d' # Yahoo supports 1d, 5d
            # But 5d might miss 7 actual days depending on weekends.
            # Safest is 1mo then slice.
            fetch_period = '1mo'
        elif args.days <= 30:
            fetch_period = '1mo'
        else:
            fetch_period = '1y'
    
    target_symbol = args.symbol

    if target_symbol:
        print(f"🚀 Running Single Symbol Mode: {target_symbol}", flush=True)
        
        # Handle TASI
        if target_symbol == 'TASI' or target_symbol == '^TASI.SR':
            if 'TASI' in stocks_map:
                 try:
                    upload_stock_history('TASI', stocks_map['TASI'], period=fetch_period, should_clear=(args.days is None), days_limit=args.days)
                 except Exception as e:
                    print(f"Failed to process TASI: {e}", flush=True)
        
        # Handle Other
        elif target_symbol in stocks_map:
            try:
                upload_stock_history(target_symbol, stocks_map[target_symbol], period=fetch_period, should_clear=(args.days is None), days_limit=args.days)
            except Exception as e:
                print(f"Failed to process {target_symbol}: {e}", flush=True)
        else:
            print(f"❌ Symbol {target_symbol} not found in ticker map.", flush=True)

    else:
        print(f"🚀 Starting Market Sync... (Period: {fetch_period}, Days={args.days})", flush=True)
        
        # Process TASI first
        if 'TASI' in stocks_map:
            tasi_item = stocks_map.pop('TASI')
            print("Processing TASI first...", flush=True)
            try:
                upload_stock_history('TASI', tasi_item, period=fetch_period, should_clear=(args.days is None), days_limit=args.days)
            except Exception as e:
                print(f"Failed to process TASI: {e}", flush=True)

        # Process all stocks
        count_i = 0
        
        for symbol_id, stock_item in stocks_map.items():
            count_i += 1
            
            try:
                upload_stock_history(symbol_id, stock_item, period=fetch_period, should_clear=(args.days is None), days_limit=args.days)
            except Exception as e:
                print(f"Failed to process {symbol_id}: {e}", flush=True)

    print("\n🎉 Sync Complete!", flush=True)
