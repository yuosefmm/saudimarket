import firebase_admin
from firebase_admin import credentials, firestore
import os
import json

# Fix for SSL if needed (Local Development only)
cacert_path = r"c:\projects\swm\cacert.pem"
if os.path.exists(cacert_path):
    os.environ["CURL_CA_BUNDLE"] = cacert_path

# Initialize Firebase
if not firebase_admin._apps:
    cred = credentials.Certificate('serviceAccountKey.json')
    firebase_admin.initialize_app(cred)
db = firestore.client()

def check_tasi_history():
    print("Checking TASI History in Firestore...")
    
    # Check Main Doc
    doc = db.collection('stocks').document('TASI').get()
    if doc.exists:
        data = doc.to_dict()
        print(f"Main Doc Valid: Price={data.get('price')}, Date={data.get('lastUpdated')}")
    else:
        print("TASI Main Document NOT FOUND!")

    # Check History
    history_ref = db.collection('stocks').document('TASI').collection('history')
    # Get last 5 entries
    docs = history_ref.order_by('time', direction=firestore.Query.DESCENDING).limit(5).stream()
    
    print("\nLatest 5 History Entries:")
    found = False
    for doc in docs:
        found = True
        d = doc.to_dict()
        print(f"  ID: {doc.id} | Date: {d.get('time')} | Close: {d.get('close')}")
        
    if not found:
        print("No history found!")

if __name__ == "__main__":
    check_tasi_history()
