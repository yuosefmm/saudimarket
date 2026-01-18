import firebase_admin
from firebase_admin import credentials, firestore
import json
import os
import sys
import glob
from datetime import datetime

# Force UTF-8
sys.stdout.reconfigure(encoding='utf-8')

# Fix SSL if needed
os.environ["CURL_CA_BUNDLE"] = r"c:\projects\swm\cacert.pem"

JSON_DIR = r"C:\Projects\SWM\stock_data_json"

def initialize_firebase():
    if not firebase_admin._apps:
        if os.getenv('SERVICE_ACCOUNT_KEY'):
             cred = credentials.Certificate(json.loads(os.getenv('SERVICE_ACCOUNT_KEY')))
        else:
            cred = credentials.Certificate('serviceAccountKey.json')
        firebase_admin.initialize_app(cred)
    return firestore.client()

def load_names():
    try:
        with open('saudi_symbols.json', 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return {}

def upload_metastock_data():
    db = initialize_firebase()
    symbol_map = load_names()
    
    files = glob.glob(os.path.join(JSON_DIR, "*.json"))
    total_files = len(files)
    print(f"Found {total_files} files to upload.")
    
    for i, file_path in enumerate(files):
        symbol = os.path.splitext(os.path.basename(file_path))[0]
        
        # Skip weird files if any
        if not symbol[0].isdigit() and symbol != "TASI":
            # Might be MT30 or others, strictly typically we want digits or TASI
            if symbol not in ['TASI', 'MT30', 'NOMUC']:
                 pass # process anyway, just noting
        
        print(f"[{i+1}/{total_files}] Uploading {symbol}...", end='', flush=True)
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
            if not data:
                print(" EMPTY (Skipping)")
                continue
                
            # Prepare Firestore References
            main_ref = db.collection('stocks').document(symbol)
            history_col = main_ref.collection('history')
            
            batch = db.batch()
            count = 0
            
            # Data is already sorted by date in convert_metastock.py
            
            for record in data:
                # Record: {date, open, high, low, close, volume}
                date_str = record['date']
                
                # Firestore Data
                doc_data = {
                    'time': date_str,
                    'open': record['open'],
                    'high': record['high'],
                    'low': record['low'],
                    'close': record['close'],
                    'volume': record['volume']
                }
                
                doc_ref = history_col.document(date_str)
                batch.set(doc_ref, doc_data)
                count += 1
                
                if count >= 400:
                    batch.commit()
                    batch = db.batch()
                    count = 0
            
            if count > 0:
                batch.commit()
                
            # Update Main Document
            last_record = data[-1]
            try:
                # Basic metadata update
                main_update = {
                    'symbol': symbol,
                    'price': last_record['close'],
                    # We don't have change/percent relative to prev day easily calculated here unless we look back
                    # But for migration, setting the price is key.
                    # Let's calc change if >1 records
                    'lastUpdated': datetime.now() 
                }
                
                if len(data) > 1:
                    prev = data[-2]
                    change = last_record['close'] - prev['close']
                    pct = (change / prev['close']) * 100 if prev['close'] else 0
                    main_update['change'] = change
                    main_update['percent'] = pct
                
                # Get name from map if possible
                if symbol in symbol_map:
                    main_update['name'] = symbol_map[symbol].get('name', symbol)
                elif symbol == 'TASI':
                    main_update['name'] = 'المؤشر العام'
                
                main_ref.set(main_update, merge=True)
                
            except Exception as e:
                print(f" (Main Doc Error: {e})", end='')

            print(" DONE")
            
        except Exception as e:
            print(f" ERROR: {e}")

if __name__ == "__main__":
    upload_metastock_data()
