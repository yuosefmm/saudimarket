import firebase_admin
from firebase_admin import credentials, firestore
import os
import sys
import json

# Force UTF-8 for Windows Console
sys.stdout.reconfigure(encoding='utf-8')

DATA_DIR = r"c:\Projects\SWM\public\data"

def initialize_firebase():
    if not firebase_admin._apps:
        # Use existing key file
        cred = credentials.Certificate('serviceAccountKey.json')
        firebase_admin.initialize_app(cred)
    return firestore.client()

def sync_stocks():
    print("Initializing Firestore Connection...")
    db = initialize_firebase()
    collection_ref = db.collection('stocks')
    
    # 1. Get List of Valid Symbols from Files
    print(f"Scanning {DATA_DIR}...")
    if not os.path.exists(DATA_DIR):
        print(f"Error: Directory {DATA_DIR} not found.")
        return

    valid_symbols = set()
    files = [f for f in os.listdir(DATA_DIR) if f.endswith('.json')]
    
    for fname in files:
        symbol = fname.replace('.json', '')
        valid_symbols.add(symbol)
        
    print(f"Found {len(valid_symbols)} local data files.")
    
    # 2. Fetch All Firestore Docs
    print("Fetching Firestore documents...")
    docs = list(collection_ref.stream())
    print(f"Firestore has {len(docs)} documents.")
    
    # 3. Identify Orphans
    orphans = []
    
    for doc in docs:
        doc_id = doc.id
        # Check against valid symbols
        # Some docs might be named TASI, others number.
        if doc_id not in valid_symbols:
            # logic check: maybe file is 1010.SR and doc is 1010? 
            # Current file convention seems to be '1010.json' or 'TASI.json'
            # Let's handle TASI mismatch just in case
            if doc_id == 'TASI' and 'TASI' in valid_symbols: continue

            orphans.append(doc_id)

    if not orphans:
        print("✅ Sync Complete. Firestore matches local files exactly.")
        return

    print(f"⚠️ Found {len(orphans)} companies in Firestore without local data.")
    print("Cleaning up...")
    
    # 4. Batch Delete Orphans
    batch = db.batch()
    count = 0
    deleted_count = 0
    
    for orphan_id in orphans:
        doc_ref = collection_ref.document(orphan_id)
        batch.delete(doc_ref)
        count += 1
        
        # Firestore batches limit is 500
        if count >= 400:
            print(f"Committing batch of {count}...")
            batch.commit()
            deleted_count += count
            batch = db.batch() # Reset
            count = 0
            
    if count > 0:
        batch.commit()
        deleted_count += count
        
    print(f"🗑️ Successfully deleted {deleted_count} orphan documents.")
    print("Active List Updated.")

if __name__ == "__main__":
    sync_stocks()
