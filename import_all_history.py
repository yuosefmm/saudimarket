import firebase_admin
from firebase_admin import credentials, firestore
import yfinance as yf
from datetime import datetime
import time
import sys
import json
import os
import pandas as pd
import numpy as np
import argparse

# Force UTF-8 for console output
try:
    sys.stdout.reconfigure(encoding='utf-8')
except:
    pass

# Constants
BACKUP_DIR = 'data_backup'
SYMBOLS_FILE = 'saudi_symbols.json'
PERIOD = '2y'

def ensure_dir(path):
    if not os.path.exists(path):
        os.makedirs(path)

def load_symbols():
    try:
        with open(SYMBOLS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"{SYMBOLS_FILE} not found.")
        return {}

def sanitize(value):
    if pd.isna(value) or np.isinf(value):
        return 0.0
    return float(value)

def calculate_indicators(df):
    if df.empty: return df

    # SMA 20 & 50
    df['SMA_20'] = df['Close'].rolling(window=20).mean()
    df['SMA_50'] = df['Close'].rolling(window=50).mean()

    # RSI 14
    delta = df['Close'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
    rs = gain / loss
    df['RSI_14'] = 100 - (100 / (1 + rs))

    # MACD (12, 26, 9)
    k_fast = df['Close'].ewm(span=12, adjust=False).mean()
    k_slow = df['Close'].ewm(span=26, adjust=False).mean()
    df['MACD'] = k_fast - k_slow
    df['MACD_Signal'] = df['MACD'].ewm(span=9, adjust=False).mean()
    df['MACD_Hist'] = df['MACD'] - df['MACD_Signal']

    # Bollinger Bands (20, 2)
    df['BB_Mid'] = df['SMA_20']
    df['BB_Std'] = df['Close'].rolling(window=20).std()
    df['BB_Up'] = df['BB_Mid'] + (2 * df['BB_Std'])
    df['BB_Low'] = df['BB_Mid'] - (2 * df['BB_Std'])

    # Donchian Channels (20)
    df['Donchian_High'] = df['High'].rolling(window=20).max()
    df['Donchian_Low'] = df['Low'].rolling(window=20).min()
    df['Donchian_Mid'] = (df['Donchian_High'] + df['Donchian_Low']) / 2

    # VWAP (Simple approximation for daily: CumSum(P*V)/CumSum(V) is usually intraday, 
    # but for daily chart we can just simulate or start fresh each month? 
    # Standard daily VWAP is just Typical Price. 
    # Let's use a rolling VWAP for 20 days proxy or just exclude if not critical)
    # Using Rolling VWAP 20 for indicator purpose
    df['TypPrice'] = (df['High'] + df['Low'] + df['Close']) / 3
    df['VP'] = df['TypPrice'] * df['Volume']
    df['VWAP_20'] = df['VP'].rolling(window=20).sum() / df['Volume'].rolling(window=20).sum()

    return df

def fetch_and_save_data():
    symbols_map = load_symbols()
    ensure_dir(BACKUP_DIR)
    
    print(f"Starting fetch for {len(symbols_map)} symbols (Period: {PERIOD})...")

    # Setup Robust Session
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry

    session = requests.Session()
    retry = Retry(connect=3, backoff_factor=1, status_forcelist=[500, 502, 503, 504])
    adapter = HTTPAdapter(max_retries=retry)
    session.mount('http://', adapter)
    session.mount('https://', adapter)
    # Increase timeout globally for this session isn't directly possible in requests session obj 
    # but yfinance uses it. We rely on retries.

    count = 0
    skipped = 0
    errors = 0
    
    for symbol_id, info in symbols_map.items():
        yf_ticker = info.get('yf_symbol')
        if not yf_ticker: continue

        # RESUME CAPABILITY: Check if already exists
        history_path = os.path.join(BACKUP_DIR, f"{symbol_id}_history.json")
        if os.path.exists(history_path):
            print(f"[{count+1}/{len(symbols_map)}] {info.get('name')} ... SKIPPING (Already exists)", flush=True)
            skipped += 1
            count += 1
            continue

        print(f"[{count+1}/{len(symbols_map)}] Fetching {info.get('name')} ({yf_ticker})...", end='', flush=True)

        try:
            # Add timeout to Ticker if possible, or reliance on retries
            ticker = yf.Ticker(yf_ticker, session=session)
            # Fetch with explicit timeout handling if yf supports pass-through, otherwise basic fetch
            try:
                df = ticker.history(period=PERIOD, interval="1d", timeout=30) # timeout param supported in newer yf/requests
            except TypeError as te:
                 # Catch 'NoneType' object is not subscriptable often caused by YF internal error on bad data
                if "'NoneType' object is not subscriptable" in str(te):
                    print(" ERROR: YF Internal Error (No Data/Blocked?)")
                    errors += 1
                    continue
                else:
                    raise te
                    
            if df.empty:
                print(" EMPTY (Skipping)")
                errors += 1
                continue

            # Process Data
            try:
                df = calculate_indicators(df)
            except Exception as calc_err:
                 print(f" Calc Error: {calc_err} ", end='')
            
            # Convert to list of dicts for JSON serialization
            history_data = []
            for index, row in df.iterrows():
                # Timestamp to milliseconds
                ts = int(index.timestamp() * 1000)
                
                # Check for NaNs in critical fields
                if pd.isna(row['Close']): continue

                record = {
                    'time': ts / 1000, # Firestore uses seconds usually, but charts use seconds/ms. Let's send regular timestamp
                    'open': sanitize(row['Open']),
                    'high': sanitize(row['High']),
                    'low': sanitize(row['Low']),
                    'close': sanitize(row['Close']),
                    'volume': int(row['Volume']),
                    'sma_20': sanitize(row.get('SMA_20')),
                    'rsi_14': sanitize(row.get('RSI_14')),
                    'macd': sanitize(row.get('MACD')),
                    'macd_signal': sanitize(row.get('MACD_Signal')),
                    'macd_hist': sanitize(row.get('MACD_Hist')),
                    'bb_up': sanitize(row.get('BB_Up')),
                    'bb_low': sanitize(row.get('BB_Low')),
                    'donchian_high': sanitize(row.get('Donchian_High')),
                    'donchian_low': sanitize(row.get('Donchian_Low')),
                }
                history_data.append(record)
            
            # Meta Data (Last Snapshot)
            last = df.iloc[-1]
            prev = df.iloc[-2] if len(df) > 1 else last
            
            change = last['Close'] - prev['Close']
            percent = (change / prev['Close']) * 100 if prev['Close'] != 0 else 0
            
            meta_data = {
                'symbol': symbol_id,
                'name': info.get('name'),
                'yf_symbol': yf_ticker,
                'price': sanitize(last['Close']),
                'change': sanitize(change),
                'percent': sanitize(percent),
                'volume': int(last['Volume']),
                'lastUpdated': int(last.name.timestamp() * 1000),
                'rsi_14': sanitize(last.get('RSI_14')),
                'sma_20': sanitize(last.get('SMA_20')),
                'macd': sanitize(last.get('MACD')),
                'macd_signal': sanitize(last.get('MACD_Signal')),
                'macd_hist': sanitize(last.get('MACD_Hist')),
                # Strategy Flags (Simple Checks)
                'strategy_bullish_div': False, # Needs complex logic, set default
                'strategy_donchian_breakout': (last['Close'] >= last.get('Donchian_High') and last['Volume'] > (df['Volume'].rolling(20).mean().iloc[-1] * 1.5)),
                'strategy_morning_star': False, # Placeholder
                'strategy_vwap_bounce': False, # Placeholder
                'donchian_entry': sanitize(last.get('Donchian_High')),
                'donchian_stop_loss': sanitize(last.get('Donchian_Mid')),
            }

            # Save to JSON
            with open(os.path.join(BACKUP_DIR, f"{symbol_id}_history.json"), 'w', encoding='utf-8') as f:
                json.dump(history_data, f, ensure_ascii=False)
                
            with open(os.path.join(BACKUP_DIR, f"{symbol_id}_meta.json"), 'w', encoding='utf-8') as f:
                json.dump(meta_data, f, ensure_ascii=False)

            print(" DONE")

        except Exception as e:
            print(f" ERROR: {e}")
            errors += 1
            
        count += 1
        # time.sleep(0.1) # Be nice to API

    print(f"\nFetch Completed. Success: {count-errors-skipped}, Skipped: {skipped}, Errors: {errors}")


def upload_to_firebase():
    print("Connecting to Firestore...")
    
    # Initialize Firebase
    if not firebase_admin._apps:
        if os.getenv('SERVICE_ACCOUNT_KEY'):
            cred = credentials.Certificate(json.loads(os.getenv('SERVICE_ACCOUNT_KEY')))
        else:
            cred = credentials.Certificate('serviceAccountKey.json')
        firebase_admin.initialize_app(cred)
    db = firestore.client()

    files = os.listdir(BACKUP_DIR)
    meta_files = [f for f in files if f.endswith('_meta.json')]
    
    print(f"Found {len(meta_files)} companies to upload.")
    
    for idx, meta_file in enumerate(meta_files):
        symbol_id = meta_file.replace('_meta.json', '')
        history_file = f"{symbol_id}_history.json"
        
        print(f"[{idx+1}/{len(meta_files)}] Uploading {symbol_id}...", end='', flush=True)
        
        try:
            # 1. Read Data
            with open(os.path.join(BACKUP_DIR, meta_file), 'r', encoding='utf-8') as f:
                meta_data = json.load(f)
            
            with open(os.path.join(BACKUP_DIR, history_file), 'r', encoding='utf-8') as f:
                history_data = json.load(f)
                
            # 2. Upload Meta
            # timestamp conversion for Firestore
            meta_data['lastUpdated'] = firestore.SERVER_TIMESTAMP
            
            doc_ref = db.collection('stocks').document(symbol_id)
            doc_ref.set(meta_data, merge=True)
            
            # 3. Upload History (Batch)
            history_col = doc_ref.collection('history')
            
            # Optional: Delete existing? Batch writes usually overwrite if IDs match
            # But we are using time-based docs usually or just auto-id?
            # Previous implementation used 'date' or just add().
            # Best is to use 'YYYY-MM-DD' as ID to prevent dupes.
            
            batch = db.batch()
            op_count = 0
            
            for point in history_data[-300:]: # Upload last 300 days only to save writes/speed? Or full? 
                # User asked for "Complete real history". Let's try full but watch limits (500 per batch).
                # Actually, 2 years is ~500 records. One batch might be enough or 2.
                
                # Convert float timestamp back to datetime for Document ID
                dt = datetime.fromtimestamp(point['time'])
                doc_id = dt.strftime('%Y-%m-%d')
                
                # Firestore Time
                point['time'] = dt
                
                hist_doc = history_col.document(doc_id)
                batch.set(hist_doc, point)
                op_count += 1
                
                if op_count >= 400:
                    batch.commit()
                    batch = db.batch()
                    op_count = 0
            
            if op_count > 0:
                batch.commit()
                
            print(" DONE")
            
        except Exception as e:
            print(f" ERROR: {e}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--fetch-only', action='store_true', help='Download data from Yahoo to local backup')
    parser.add_argument('--upload-only', action='store_true', help='Upload local backup to Firebase')
    args = parser.parse_args()

    if args.fetch_only:
        fetch_and_save_data()
    elif args.upload_only:
        upload_to_firebase()
    else:
        print("Please specify --fetch-only or --upload-only")
