import yfinance as yf
import pandas as pd
import numpy as np
import json
import sys
import os
import time

# Force UTF-8
sys.stdout.reconfigure(encoding='utf-8')

# Fix for SSL error
os.environ["CURL_CA_BUNDLE"] = r"c:\projects\swm\cacert.pem"

# Constants
SYMBOLS_FILE = 'saudi_symbols.json'
OUTPUT_FILE = 'market_data_temp.json'

def load_symbols():
    try:
        with open(SYMBOLS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
            # Ensure TASI is in the map
            if 'TASI' not in data:
                data['TASI'] = {
                    'symbol': 'TASI',
                    'yf_symbol': '^TASI.SR',
                    'name': 'المؤشر العام'
                }
            return data
    except Exception as e:
        print(f"Error loading symbols: {e}")
        return {}

def sanitize(value):
    if pd.isna(value) or np.isinf(value):
        return 0.0
    return float(value)

def fetch_all():
    stocks_map = load_symbols()
    print(f"Loaded {len(stocks_map)} symbols.", flush=True)
    
    all_data = {}
    
    # Process TASI first ensures it's at the top of the file
    if 'TASI' in stocks_map:
        tasi = stocks_map.pop('TASI')
        stocks_map = {'TASI': tasi, **stocks_map}
        
    count = 0
    total = len(stocks_map)
    
    for symbol_id, info in stocks_map.items():
        count += 1
        yf_sym = info.get('yf_symbol')
        
        # print(f"[{count}/{total}] Fetching {symbol_id}...", flush=True)
        if count % 10 == 0:
             print(f"Progress: {count}/{total}", flush=True)

        try:
            ticker = yf.Ticker(yf_sym)
            df = ticker.history(period="1y")
            
            if df.empty:
                continue
                
            history_data = []
            
            # Helper for stats
            latest_close = 0
            latest_change = 0
            latest_percent = 0
            closes = df['Close'].tolist()
            
            for index, row in df.iterrows():
                if pd.isna(row['Open']) or pd.isna(row['Close']): continue
                # Skip weekends
                if index.dayofweek == 4 or index.dayofweek == 5: continue
                
                date_str = index.strftime('%Y-%m-%d')
                
                record = {
                    'time': date_str,
                    'open': sanitize(row['Open']),
                    'high': sanitize(row['High']),
                    'low': sanitize(row['Low']),
                    'close': sanitize(row['Close']),
                    'volume': int(row['Volume']) if not pd.isna(row['Volume']) else 0
                }
                history_data.append(record)
                latest_close = record['close']
                
            # Calcs
            if len(closes) >= 2:
                latest_change = closes[-1] - closes[-2]
                if closes[-2] > 0:
                    latest_percent = (latest_change / closes[-2]) * 100
            
            # Fast info for yearly stats
            fast_info = ticker.fast_info
            
            stock_record = {
                'symbol_id': symbol_id,
                'name': info.get('name', symbol_id),
                'price': sanitize(latest_close),
                'change': sanitize(latest_change),
                'percent': sanitize(latest_percent),
                'year_high': sanitize(fast_info.year_high) if fast_info.year_high else 0.0,
                'year_low': sanitize(fast_info.year_low) if fast_info.year_low else 0.0,
                'history': history_data
            }
            
            all_data[symbol_id] = stock_record
            
        except Exception as e:
            print(f"Failed {symbol_id}: {e}", flush=True)
            
    # Save to JSON
    print(f"Saving {len(all_data)} stocks to {OUTPUT_FILE}...", flush=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(all_data, f, ensure_ascii=False, indent=2)
    print("Done.", flush=True)

if __name__ == "__main__":
    fetch_all()
