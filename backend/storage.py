
from datetime import datetime
from .config import get_db, BATCH_SIZE

def delete_collection(coll_ref, limit=400):
    """
    Deletes a collection in batches.
    """
    docs = coll_ref.limit(limit).stream()
    deleted = 0

    for doc in docs:
        doc.reference.delete()
        deleted += 1

    if deleted >= limit:
        return delete_collection(coll_ref, limit)

def upload_history_batch(symbol_id, history_data, should_clear=False):
    """
    Uploads a list of history records to Firestore.
    history_data should be a list of dicts:
    [{'time': '2023-01-01', 'open': 10, ...}, ...]
    """
    db = get_db()
    history_ref = db.collection('stocks').document(symbol_id).collection('history')

    if should_clear:
        # print(f"      Clearing old history for {symbol_id}...")
        delete_collection(history_ref, limit=BATCH_SIZE)

    batch = db.batch()
    count = 0
    total_uploaded = 0

    for record in history_data:
        # Use date as document ID for easy overwriting/deduplication
        doc_ref = history_ref.document(record['time'])
        batch.set(doc_ref, record)
        count += 1

        if count >= BATCH_SIZE:
            batch.commit()
            batch = db.batch()
            total_uploaded += count
            count = 0

    if count > 0:
        batch.commit()
        total_uploaded += count
    
    return total_uploaded

def update_stock_meta(symbol_id, data):
    """
    Updates the main stock document (price, name, etc.)
    """
    db = get_db()
    doc_ref = db.collection('stocks').document(symbol_id)
    doc_ref.set(data, merge=True)
