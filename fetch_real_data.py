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

def upload_stock_history(symbol_id, stock_info, period, should_clear=False):
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
        # If FULL_SYNC is NOT set, we only write the last 3 days to save writes
        is_full_sync = os.getenv('FULL_SYNC', 'false').lower() == 'true'
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
                'lastUpdated': datetime.now()
            }
            
            main_doc_ref.set(current_data, merge=True)
        else:
             print("      No valid records.", flush=True)

    except Exception:
        print(f"Errors on {symbol_id}", flush=True)
        traceback.print_exc()

def convert_val(val):
    if pd.isna(val) or np.isinf(val):
        return 0.0
    return float(val)

# --- MAIN EXECUTION ---
print("🚀 Starting Full Market Sync (yfinance + Technicals)...", flush=True)

# Add TASI explicitly if not in list
if 'TASI' not in stocks_map:
    stocks_map['TASI'] = {
        'symbol': 'TASI',
        'yf_symbol': '^TASI.SR',
        'name': 'المؤشر العام'
    }

# Process TASI first
if 'TASI' in stocks_map:
    tasi_item = stocks_map.pop('TASI')
    print("Processing TASI first...", flush=True)
    try:
        upload_stock_history('TASI', tasi_item, period='1y', should_clear=True)
    except Exception as e:
        print(f"Failed to process TASI: {e}", flush=True)

# Process all stocks
count_i = 0
total = len(stocks_map)

for symbol_id, stock_item in stocks_map.items():
    count_i += 1
    
    # REMOVED LIMIT - PROCESS ALL
    # if count_i > 3: 
    #     continue

    # We use 1yr range to get history.
    try:
        upload_stock_history(symbol_id, stock_item, period='1y', should_clear=True)
    except Exception as e:
        print(f"Failed to process {symbol_id}: {e}", flush=True)

print("\n🎉 Full Sync Complete!", flush=True)
