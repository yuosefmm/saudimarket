
import firebase_admin
from firebase_admin import credentials, firestore
import yfinance as yf
from datetime import datetime
import sys
import os

# Fix for SSL if needed (locally), on GitHub Actions likely not needed but harmless
# os.environ["CURL_CA_BUNDLE"] = "" 

def update_tasi():
    # Initialize Firebase
    try:
        # Check if running in GitHub Actions (env var) or local
        if os.getenv('FIREBASE_SERVICE_ACCOUNT'):
            cred = credentials.Certificate(json.loads(os.getenv('FIREBASE_SERVICE_ACCOUNT')))
        elif os.path.exists('serviceAccountKey.json'):
             cred = credentials.Certificate('serviceAccountKey.json')
        else:
            # Try default if on GCloud, or fail
            try:
                if not len(firebase_admin._apps):
                     firebase_admin.initialize_app()
                db = firestore.client()
            except:
                 print("No credentials found.")
                 return

        if not len(firebase_admin._apps):
            firebase_admin.initialize_app(cred)
        
        db = firestore.client()
        print("Firebase initialized.")

    except Exception as e:
        print(f"Error initializing Firebase: {e}")
        # fallback for existing app
        try:
             db = firestore.client()
        except:
             return

    # TASI Symbol on Yahoo Finance
    yf_symbol = "^TASI.SR"
    
    print(f"Fetching {yf_symbol}...")
    try:
        ticker = yf.Ticker(yf_symbol)
        
        # Fast Info
        price = ticker.fast_info.last_price
        prev = ticker.fast_info.previous_close
        
        # 52 Week
        year_high = ticker.fast_info.year_high
        year_low = ticker.fast_info.year_low
        
        if price is None:
            print("Failed to fetch price.")
            return

        timestamp = datetime.now()
        
        change = 0.0
        percent = 0.0
        if prev:
            change = price - prev
            percent = (change / prev) * 100
        
        print(f"TASI: {price} ({percent:.2f}%)")
        
        doc_ref = db.collection('stocks').document('TASI')
        update_data = {
            'price': float(price),
            'change': float(change),
            'percent': float(percent),
            'lastUpdated': timestamp,
            'name': 'المؤشر العام',
            'symbol': 'TASI',
            'year_high': float(year_high) if year_high else 0.0,
            'year_low': float(year_low) if year_low else 0.0
        }
        
        doc_ref.set(update_data, merge=True)
        print("TASI updated successfully.")

    except Exception as e:
        print(f"Error updating TASI: {e}")

if __name__ == "__main__":
    import json
    update_tasi()
