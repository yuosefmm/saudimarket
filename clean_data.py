import firebase_admin
from firebase_admin import credentials, firestore
import os
from datetime import datetime
import time

# Fix for SSL
os.environ["CURL_CA_BUNDLE"] = r"c:\projects\swm\cacert.pem"

def clean_data():
    try:
        # Init
        if os.path.exists('serviceAccountKey.json'):
             cred = credentials.Certificate('serviceAccountKey.json')
             # check if app is already init
             if not len(firebase_admin._apps):
                 firebase_admin.initialize_app(cred)
        else:
             print("No key found.")
             return
        
        db = firestore.client()
        print("Firebase initialized.")
        
        # Iterate all stocks
        docs = db.collection('stocks').stream()
        
        for doc in docs:
            symbol = doc.id
            print(f"Checking {symbol}...")
            
            history_ref = db.collection('stocks').document(symbol).collection('history')
            history_docs = history_ref.stream()
            
            batch = db.batch()
            batch_count = 0
            deleted = 0
            
            for h_doc in history_docs:
                data = h_doc.to_dict()
                date_str = data.get('time')
                
                if not date_str: continue
                
                # Check Weekday
                dt = datetime.strptime(date_str, '%Y-%m-%d')
                # Mon=0, Sun=6. Fri=4, Sat=5.
                # Saudi Market: Sun-Thu. Fri-Sat Closed.
                if dt.weekday() in [4, 5]:
                    print(f"   Deleting Weekend: {date_str} ({dt.strftime('%A')})")
                    batch.delete(h_doc.reference)
                    batch_count += 1
                    deleted += 1
                
                if batch_count >= 100:
                    batch.commit()
                    batch = db.batch()
                    batch_count = 0
            
            if batch_count > 0:
                batch.commit()
            
            if deleted > 0:
                print(f"   Removed {deleted} weekend records for {symbol}.")
                
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    clean_data()
