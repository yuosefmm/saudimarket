import firebase_admin
from firebase_admin import credentials, firestore
import json
import os
from datetime import datetime

# Fix for SSL
# Fix for SSL if needed
cacert_path = r"c:\projects\swm\cacert.pem"
if os.path.exists(cacert_path):
    os.environ["CURL_CA_BUNDLE"] = cacert_path

def check_data():
    # Initialize Firebase
    try:
        print("Steps: Checking key...")
        if os.path.exists('serviceAccountKey.json'):
             print("Steps: Loading Cred...")
             cred = credentials.Certificate('serviceAccountKey.json')
             print("Steps: Initializing App...")
             if not len(firebase_admin._apps):
                 firebase_admin.initialize_app(cred)
             print("Steps: Getting Client...")
        else:
             print("serviceAccountKey.json not found.")
             return
        
        db = firestore.client()
        print("Firebase initialized.")

        doc_ref = db.collection('stocks').document('TASI')
        doc = doc_ref.get()

        if doc.exists:
            data = doc.to_dict()
            print(f"--- TASI Data (Main Doc) ---")
            print(f"Name: {data.get('name')}")
            print(f"Price: {data.get('price')}")
            print(f"Last Updated: {data.get('lastUpdated')}")
            
            # Query Subcollection 'history'
            print("Steps: Querying History Subcollection...")
            history_ref = doc_ref.collection('history')
            
            # Get last 3 ordered by time
            query = history_ref.order_by('time', direction=firestore.Query.DESCENDING).limit(3)
            results = query.stream()
            
            print("--- History (Last 3) ---")
            found = False
            for res in results:
                found = True
                print(f"Doc ID: {res.id} => {res.to_dict()}")
            
            if not found:
                print("WARNING: No history documents found.")
                
        else:
            print("Document 'stocks/TASI' does not exist.")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_data()
