import yfinance as yf
import firebase_admin
from firebase_admin import credentials, firestore
import sys

# Force UTF-8
sys.stdout.reconfigure(encoding='utf-8')

import os
os.environ["CURL_CA_BUNDLE"] = r"c:\projects\swm\cacert.pem"

print("1. Testing yfinance...", flush=True)
try:
    ticker = yf.Ticker("1120.SR")
    hist = ticker.history(period="5d")
    print(f"   Success! Fetched {len(hist)} rows.", flush=True)
    if not hist.empty:
        print(f"   Latest: {hist.iloc[-1]['Close']}", flush=True)
except Exception as e:
    print(f"   Error: {e}", flush=True)

print("\n2. Testing Firestore...", flush=True)
try:
    if not firebase_admin._apps:
        cred = credentials.Certificate('serviceAccountKey.json')
        firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("   Initialized.", flush=True)
    
    # Write test
    db.collection('test_connection').document('ping').set({'status': 'ok'})
    print("   Write Success.", flush=True)
except Exception as e:
    print(f"   Error: {e}", flush=True)
