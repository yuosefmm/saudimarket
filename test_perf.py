import yfinance as yf
import sys
import time
import os
import firebase_admin
from firebase_admin import credentials, firestore

sys.stdout.reconfigure(encoding='utf-8')
os.environ["CURL_CA_BUNDLE"] = r"c:\projects\swm\cacert.pem"

print("1. Testing ^TASI.SR 1y fetch...", flush=True)
start = time.time()
try:
    ticker = yf.Ticker("^TASI.SR")
    df = ticker.history(period="1y")
    print(f"   Fetch Done in {time.time() - start:.2f}s. Rows: {len(df)}", flush=True)
    
    if df.empty:
        print("   WARNING: DataFrame is empty!", flush=True)
    else:
        print(f"   Latest date: {df.index[-1]}", flush=True)
        print(f"   Latest close: {df.iloc[-1]['Close']}", flush=True)

    # Test batch write with REAL data
    print("\n2. Testing Firestore batch write (Real Data)...", flush=True)
    if not firebase_admin._apps:
        cred = credentials.Certificate('serviceAccountKey.json')
        firebase_admin.initialize_app(cred)
    db = firestore.client()
    
    batch = db.batch()
    history_ref = db.collection('test_batch_real').document('tasi').collection('history')
    
    count = 0
    for index, row in df.iterrows():
        if count >= 10: break # Test small batch
        
        date_str = index.strftime('%Y-%m-%d')
        doc_data = {
            'time': date_str,
            'open': float(row['Open']),
            'high': float(row['High']),
            'low': float(row['Low']),
            'close': float(row['Close']),
            'volume': int(row['Volume'])
        }
        
        doc_ref = history_ref.document(date_str)
        batch.set(doc_ref, doc_data)
        count += 1

    print(f"   Prepared {count} items. Committing...", flush=True)
    commit_start = time.time()
    batch.commit()
    print(f"   Batch Write Done in {time.time() - commit_start:.2f}s.", flush=True)

except Exception as e:
    print(f"   Error: {e}", flush=True)
