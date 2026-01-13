import firebase_admin
from firebase_admin import credentials, firestore
import yfinance as yf
import time
from datetime import datetime
import sys
import os
import json

# Fix for SSL error due to non-ASCII username path
os.environ["CURL_CA_BUNDLE"] = r"c:\projects\swm\cacert.pem"

# Initialize Firebase Admin
try:
    if not len(firebase_admin._apps):
        cred = credentials.Certificate('serviceAccountKey.json')
        firebase_admin.initialize_app(cred)
    db = firestore.client()
except Exception as e:
    print(f"Error initializing Firebase: {e}")
    sys.exit(1)

def load_symbols():
    try:
        with open('saudi_symbols.json', 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        print("saudi_symbols.json not found. Run generate_symbols.py first.")
        return {}

def update_prices():
    timestamp = datetime.now()
    print(f"Starting update at {timestamp.strftime('%H:%M:%S')}")
    
    symbols_map = load_symbols()
    if not symbols_map:
        return

    # Prepare batches for yfinance (it prefers space separated string)
    # yfinance can handle valid batches, but too many might timeout. 
    # Let's chunk it. 50 at a time is safe.
    
    yf_symbols = [v['yf_symbol'] for k, v in symbols_map.items()]
    
    chunk_size = 50
    updated_count = 0
    
    for i in range(0, len(yf_symbols), chunk_size):
        chunk = yf_symbols[i:i + chunk_size]
        chunk_str = " ".join(chunk)
        
        try:
            print(f"Fetching chunk {i // chunk_size + 1}...")
            tickers = yf.Tickers(chunk_str)
            
            batch = db.batch()
            batch_count = 0
            
            for yf_sym, ticker in tickers.tickers.items():
                # Find local symbol for this yf_sym
                # Inefficient lookup but map is small enough (500 items)
                # Reverse lookup or just iterate map
                local_sym = next((k for k, v in symbols_map.items() if v['yf_symbol'] == yf_sym), None)
                if not local_sym: continue
                
                try:
                    # Try fast_info
                        # fast_info might be lazy loaded.
                        # Accessing a property triggers fetch.
                        price = ticker.fast_info.last_price
                        prev = ticker.fast_info.previous_close
                        
                        # Fetch 52 Week High/Low (Year High/Low)
                        year_high = ticker.fast_info.year_high
                        year_low = ticker.fast_info.year_low
                        
                        if price is not None:
                            change = 0.0
                            percent = 0.0
                            if prev:
                                change = price - prev
                                percent = (change / prev) * 100
                            
                            doc_ref = db.collection('stocks').document(local_sym)
                            update_data = {
                                'price': float(price),
                                'change': float(change),
                                'percent': float(percent),
                                'lastUpdated': timestamp,
                                'name': symbols_map[local_sym]['name'], # Ensure name is synced
                                'symbol': local_sym,
                                'year_high': float(year_high) if year_high is not None else 0.0,
                                'year_low': float(year_low) if year_low is not None else 0.0
                            }
                            
                            batch.set(doc_ref, update_data, merge=True)
                            batch_count += 1
                except Exception as e:
                    # Use standard warnings instead of print per stock to avoid clutter
                    pass

            if batch_count > 0:
                batch.commit()
                updated_count += batch_count
                
        except Exception as e:
            print(f"Error processing chunk: {e}")

    print(f"Finished update. Updated {updated_count} stocks.")

def main():
    print("Stock Updater Service (Full Market) Started")
    print("Press Ctrl+C to stop")
    
    # Run once immediately
    update_prices()
    
    while True:
        # Sleep for 15 minutes (900 seconds)
        print("Sleeping for 15 minutes...")
        time.sleep(900) 
        update_prices()

if __name__ == "__main__":
    main()
