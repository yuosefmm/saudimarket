import firebase_admin
from firebase_admin import credentials, firestore
import yfinance as yf
import pandas as pd
import numpy as np
import json
import os
import sys
from datetime import datetime, timedelta

# Force UTF-8
sys.stdout.reconfigure(encoding='utf-8')

# Fix SSL
os.environ["CURL_CA_BUNDLE"] = r"c:\projects\swm\cacert.pem"

DATA_DIR = r"c:\Projects\SWM\public\data"

def initialize_firebase():
    if not firebase_admin._apps:
        if os.getenv('SERVICE_ACCOUNT_KEY'):
             cred = credentials.Certificate(json.loads(os.getenv('SERVICE_ACCOUNT_KEY')))
        else:
            cred = credentials.Certificate('serviceAccountKey.json')
        firebase_admin.initialize_app(cred)
    return firestore.client()

def load_symbols():
    try:
        with open('saudi_symbols.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
            if 'TASI' not in data:
                data['TASI'] = { 'symbol': 'TASI', 'yf_symbol': '^TASI.SR', 'name': 'المؤشر العام' }
            return data
    except:
        return { 'TASI': { 'symbol': 'TASI', 'yf_symbol': '^TASI.SR', 'name': 'المؤشر العام' } }

def sanitize(value):
    if pd.isna(value) or np.isinf(value):
        return 0.0
    return float(value)

def fetch_updates_local():
    db = initialize_firebase()
    symbols = load_symbols()
    
    print(f"Starting Local Incremental Update (Hybrid Mode)...")
    
    # Iterate over files in public/data, or symbols?
    # Better to iterate symbols and check if file exists, to handle new stocks eventually.
    # But for now, we only have files for what we converted.
    
    files = [f for f in os.listdir(DATA_DIR) if f.endswith('.json')]
    print(f"Found {len(files)} local JSON files.")
    
    for filename in files:
        symbol_id = filename.replace('.json', '')
        file_path = os.path.join(DATA_DIR, filename)
        
        # Load Local Data
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                history_data = json.load(f)
        except Exception as e:
            print(f"Error reading {filename}: {e}")
            continue
            
        if not history_data:
            print(f"Empty data for {symbol_id}")
            continue
            
        # Get Last Date
        last_record = history_data[-1]
        last_date_str = last_record.get('date') or last_record.get('time')
        # Format might be YYYY-MM-DD or full timestamp? 
        # Convert MetaStock uses 'date': 'YYYY-MM-DD'.
        
        if not last_date_str:
            print(f"Invalid date format in {symbol_id}")
            continue
            
        # Parse Last Date
        try:
            # If string contains T (ISO), split id
            if 'T' in last_date_str:
                last_date_str = last_date_str.split('T')[0]
                
            last_dt = datetime.strptime(last_date_str, "%Y-%m-%d")
        except:
             print(f"Date parse error {last_date_str} for {symbol_id}")
             continue
             
        # YFinance Fetch Start (Start from Last Date to catch partial day updates)
        start_dt = last_dt
        start_str = start_dt.strftime("%Y-%m-%d")
        
        # Check if start_str is in future (Tommorow)
        if start_dt.date() > datetime.now().date():
            print(f"[{symbol_id}] Up to date.")
            continue
            
        # Symbol Mapping (Get YF Ticker)
        yf_symbol = None
        stock_name = symbol_id
        if symbol_id in symbols:
            yf_symbol = symbols[symbol_id].get('yf_symbol')
            stock_name = symbols[symbol_id].get('name', symbol_id)
        else:
            # Try appending .SR
            yf_symbol = f"{symbol_id}.SR"
            
        print(f"[{symbol_id}] Checking updates from {start_str}...", end='', flush=True)
        
        try:
            ticker = yf.Ticker(yf_symbol)
            df = ticker.history(start=start_str, interval="1d")
            
            if df.empty:
                print(" No Data.")
            else:
                new_count = 0
                updated_count = 0
                
                for index, row in df.iterrows():
                    record_dt = index.to_pydatetime().replace(tzinfo=None)
                    date_str = record_dt.strftime('%Y-%m-%d')
                    
                    # Compute Techs / Sanitize
                    new_rec = {
                        'date': date_str,
                        'open': sanitize(row['Open']),
                        'high': sanitize(row['High']),
                        'low': sanitize(row['Low']),
                        'close': sanitize(row['Close']),
                        'volume': int(row['Volume'])
                    }
                    
                    # Logic: Check if date exists in history
                    # We only check the LAST record for efficiency (since we queried from last_date)
                    last_hist_date = history_data[-1].get('date', '').split('T')[0]
                    
                    if last_hist_date == date_str:
                        # UPDATE existing today's candle
                        history_data[-1] = new_rec
                        updated_count += 1
                    elif record_dt.date() > last_dt.date():
                        # APPEND new day
                        history_data.append(new_rec)
                        new_count += 1
                
                if new_count > 0 or updated_count > 0:
                    # Save back to JSON
                    with open(file_path, 'w', encoding='utf-8') as f:
                        json.dump(history_data, f, indent=0) # Compact
                    print(f" Added {new_count} records.", end='')
                else:
                    print(f" No new valid records.", end='')

            # UPDATE FIRESTORE MAIN DOC (Dashboard)
            # Use the very latest record (from file, which includes new update)
            latest = history_data[-1]
            prev = history_data[-2] if len(history_data) > 1 else latest
            
            p_close = latest['close']
            p_prev = prev['close']
            change = p_close - p_prev
            percent = (change / p_prev) * 100 if p_prev else 0
            
            # Indicators for Scanner (Calculation on last 30 days)
            # We can do a quick DataFrame calc here
            subset = history_data[-50:]
            df_sub = pd.DataFrame(subset)
            if not df_sub.empty:
                df_sub['close'] = df_sub['close'].astype(float)
                # SMA 20
                sma20 = df_sub['close'].rolling(20).mean().iloc[-1]
                # RSI 14
                delta = df_sub['close'].diff()
                gain = (delta.where(delta > 0, 0)).rolling(14).mean()
                loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
                rs = gain / loss
                rsi = 100 - (100 / (1 + rs))
                rsi_val = rsi.iloc[-1]
                # MACD
                k_fast = df_sub['close'].ewm(span=12, adjust=False).mean()
                k_slow = df_sub['close'].ewm(span=26, adjust=False).mean()
                macd = (k_fast - k_slow).iloc[-1]
                macd_sig = (k_fast - k_slow).ewm(span=9, adjust=False).mean().iloc[-1]
                macd_hist = macd - macd_sig
            else:
                sma20 = 0; rsi_val = 50; macd = 0; macd_sig = 0; macd_hist = 0

            doc_ref = db.collection('stocks').document(symbol_id)
            doc_ref.set({
                'symbol': symbol_id,
                'name': stock_name,
                'price': sanitize(p_close),
                'change': sanitize(change),
                'percent': sanitize(percent),
                'volume': latest['volume'],
                'lastUpdated': datetime.now(),
                'rsi_14': sanitize(rsi_val),
                'sma_20': sanitize(sma20),
                'macd': sanitize(macd),
                'macd_hist': sanitize(macd_hist),
                'macd_signal': sanitize(macd_sig)
            }, merge=True)
            
            print(" (Firestore Updated)")

        except Exception as e:
            print(f" Error: {e}")

if __name__ == "__main__":
    fetch_updates_local()
