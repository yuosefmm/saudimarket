import yfinance as yf
import pandas as pd
import numpy as np
import sys
import os
import firebase_admin
from firebase_admin import credentials, firestore

sys.stdout.reconfigure(encoding='utf-8')
os.environ["CURL_CA_BUNDLE"] = r"c:\projects\swm\cacert.pem"

def sanitize(value):
    if pd.isna(value) or np.isinf(value):
        return 0.0
    return float(value)

print("1. Fetching TASI data...", flush=True)
ticker = yf.Ticker("^TASI.SR")
df = ticker.history(period="5d")
print(f"   Fetched {len(df)} rows.", flush=True)

if df.empty:
    print("   Data is empty.", flush=True)
    sys.exit()

# Inspect first row
row = df.iloc[-1]
print("   Sample Row Data:", flush=True)
print(f"   Open: {row['Open']} (Type: {type(row['Open'])})", flush=True)
print(f"   High: {row['High']} (Type: {type(row['High'])})", flush=True)

# Prepare sanitized data
doc_data = {
    'time': 'TEST_DIAGNOSE',
    'open': sanitize(row['Open']),
    'high': sanitize(row['High']),
    'low': sanitize(row['Low']),
    'close': sanitize(row['Close']),
    'volume': int(row['Volume']) if not pd.isna(row['Volume']) else 0
}
print(f"   Sanitized Data: {doc_data}", flush=True)

print("\n2. Writing to Firestore...", flush=True)
try:
    if not firebase_admin._apps:
        cred = credentials.Certificate('serviceAccountKey.json')
        firebase_admin.initialize_app(cred)
    db = firestore.client()
    
    ref = db.collection('test_batch_real').document('diagnose_write')
    ref.set(doc_data)
    print("   Write SUCCESS!", flush=True)
except Exception as e:
    print(f"   Write FAILED: {e}", flush=True)
