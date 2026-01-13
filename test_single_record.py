import firebase_admin
from firebase_admin import credentials, firestore
import sys
import os

sys.stdout.reconfigure(encoding='utf-8')
os.environ["CURL_CA_BUNDLE"] = r"c:\projects\swm\cacert.pem"

print("Initializing Firestore...", flush=True)
if not firebase_admin._apps:
    cred = credentials.Certificate('serviceAccountKey.json')
    firebase_admin.initialize_app(cred)

db = firestore.client()

doc_data = {
    'time': '2026-01-01',
    'open': 100.50,
    'high': 101.20,
    'low': 99.80,
    'close': 100.90,
    'volume': 150000
}

print("Writing single record...", flush=True)
try:
    ref = db.collection('test_batch_real').document('tasi').collection('history').document('2026-01-01')
    ref.set(doc_data)
    print("Write SUCCESS!", flush=True)
except Exception as e:
    print(f"Write FAILED: {e}", flush=True)
