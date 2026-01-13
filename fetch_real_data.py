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
os.environ["CURL_CA_BUNDLE"] = r"c:\projects\swm\cacert.pem"

# 1. Initialize Firebase
if not firebase_admin._apps:
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

        # B. PREPARE FIRESTORE
        # Redirect to DEBUG collection to test if 'stocks' is broken
        history_ref = db.collection('stocks_debug').document(symbol_id).collection('history')
        
        items_to_write = []
        
        count = 0
        latest_close = 0
        latest_change = 0
        latest_percent = 0
        
        closes = df['Close'].tolist()
        
        for index, row in df.iterrows():
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
            
            latest_close = doc_data['close']
            count += 1
            
        # Execute writes SEQUENTIALLY with logging
        print(f"      Writing {len(items_to_write)} records (Sequential/Sanitized/DEBUG_COLL)...", flush=True)
        
        write_count = 0
        for ref, data in items_to_write:
            try:
                # print(f"        Writing {data['time']}...", end='', flush=True) 
                ref.set(data)
                # print(" OK", flush=True)
                write_count += 1
                if write_count % 10 == 0:
                   print(f"        {write_count}/{len(items_to_write)}", flush=True)
            except Exception as e:
                print(f"        Error writing {data['time']}: {e}", flush=True)
            
        # Calculate change
        if len(closes) >= 2:
            latest_change = closes[-1] - closes[-2]
            if closes[-2] > 0:
                latest_percent = (latest_change / closes[-2]) * 100

        print(f"      Uploaded {count} records.", flush=True)

        if count > 0:
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
                'year_low': sanitize(info.year_low) if info.year_low else 0.0
            }
            
            main_doc_ref.set(current_data, merge=True)
        else:
             print("      No valid records.", flush=True)

    except Exception:
        print(f"Errors on {symbol_id}", flush=True)
        traceback.print_exc()

# --- MAIN EXECUTION ---
print("🚀 Starting Full Market Sync (yfinance)...", flush=True)

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
    
    # DEBUG: Limit to first 3 stocks
    if count_i > 3: 
        continue

    # We use 1yr range to get history.
    try:
        upload_stock_history(symbol_id, stock_item, period='1y', should_clear=True)
    except Exception as e:
        print(f"Failed to process {symbol_id}: {e}", flush=True)

print("\n🎉 Full Sync Complete!", flush=True)
