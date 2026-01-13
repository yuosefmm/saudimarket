import firebase_admin
from firebase_admin import credentials, firestore
import json
import sys
import os
import time

# Force UTF-8
sys.stdout.reconfigure(encoding='utf-8')

# Fix SSL just in case
os.environ["CURL_CA_BUNDLE"] = r"c:\projects\swm\cacert.pem"

INPUT_FILE = 'market_data_temp.json'

def upload_all():
    print("1. Loading data from JSON...", flush=True)
    try:
        with open(INPUT_FILE, 'r', encoding='utf-8') as f:
            all_data = json.load(f)
    except FileNotFoundError:
        print(f"File {INPUT_FILE} not found. Run fetch_to_json.py first.", flush=True)
        return

    print(f"   Loaded {len(all_data)} stocks.", flush=True)

    print("2. Initializing Firestore...", flush=True)
    if not firebase_admin._apps:
        cred = credentials.Certificate('serviceAccountKey.json')
        firebase_admin.initialize_app(cred)
    db = firestore.client()

    print("3. Starting Upload (Sequential)...", flush=True)
    
    count = 0
    total = len(all_data)
    
    for symbol_id, stock_data in all_data.items():
        count += 1
        
        # Prepare refs
        main_ref = db.collection('stocks').document(symbol_id)
        history_coll_ref = main_ref.collection('history')
        
        # 1. Update Main Doc
        main_doc_data = {
            'symbol': stock_data['symbol_id'],
            'name': stock_data['name'],
            'price': stock_data['price'],
            'change': stock_data['change'],
            'percent': stock_data['percent'],
            'year_high': stock_data['year_high'],
            'year_low': stock_data['year_low']
        }
        
        try:
            main_ref.set(main_doc_data, merge=True)
            
            # 2. Update History
            history_list = stock_data.get('history', [])
            
            # QUOTA OPTIMIZATION:
            # Free tier = 20k writes/day.
            # Full upload = ~100k writes -> Causes 429 Error / Hang.
            # Policy: Full history for TASI, Last 7 days for others.
            
            if symbol_id == 'TASI':
                target_history = history_list # Full history
            else:
                target_history = history_list[-7:] # Last 7 records only
            
            # Use batching here safely because no yfinance conflict? 
            # Let's try small batches of 50 for speed + safety.
            batch = db.batch()
            batch_count = 0
            
            for hist_item in target_history:
                doc_ref = history_coll_ref.document(hist_item['time'])
                batch.set(doc_ref, hist_item)
                batch_count += 1
                
                if batch_count >= 50:
                    batch.commit()
                    batch = db.batch()
                    batch_count = 0
            
            if batch_count > 0:
                batch.commit()
                
            if count % 10 == 0:
                print(f"   Uploaded {count}/{total}: {symbol_id} ({len(target_history)} days)", flush=True)
                
        except Exception as e:
            print(f"   Error uploading {symbol_id}: {e}", flush=True)

    print("\n🎉 Upload Phase Complete!", flush=True)

if __name__ == "__main__":
    upload_all()
