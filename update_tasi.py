
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
        if os.getenv('SERVICE_ACCOUNT_KEY'):
             cred = credentials.Certificate(json.loads(os.getenv('SERVICE_ACCOUNT_KEY')))
        elif os.getenv('FIREBASE_SERVICE_ACCOUNT'):
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
        
        # 1. Get Today's Candle (OHLC)
        df = ticker.history(period="1d")
        if df.empty:
            print("No data fetched for today.")
            return

        last_row = df.iloc[-1]
        timestamp = last_row.name # DateTime Index
        date_str = timestamp.strftime('%Y-%m-%d')
        
        # Values
        open_val = float(last_row['Open'])
        high_val = float(last_row['High'])
        low_val = float(last_row['Low'])
        close_val = float(last_row['Close'])
        volume_val = int(last_row['Volume'])
        
        # 2. Get Fast Info for Header Stats
        fast_info = ticker.fast_info
        price = fast_info.last_price
        prev = fast_info.previous_close
        year_high = fast_info.year_high
        year_low = fast_info.year_low
        
        change = 0.0
        percent = 0.0
        if prev:
            change = price - prev
            percent = (change / prev) * 100
        
        print(f"TASI: {price} ({percent:.2f}%) | Date: {date_str}")
        
        # 3. Update Main Document (Header)
        doc_ref = db.collection('stocks').document('TASI')
        update_data = {
            'price': float(price),
            'change': float(change),
            'percent': float(percent),
            'lastUpdated': datetime.now(),
            'name': 'المؤشر العام',
            'symbol': 'TASI',
            'year_high': float(year_high) if year_high else 0.0,
            'year_low': float(year_low) if year_low else 0.0
        }
        doc_ref.set(update_data, merge=True)
        print("Header updated.")

        # 4. Update History Subcollection (Chart)
        history_ref = doc_ref.collection('history').document(date_str)
        history_data = {
            'time': date_str,
            'open': open_val,
            'high': high_val,
            'low': low_val,
            'close': close_val,
            'volume': volume_val
        }
        history_ref.set(history_data) # Overwrite if exists for today to refine data
        print(f"History updated for {date_str}.")

    except Exception as e:
        print(f"Error updating TASI: {e}")

if __name__ == "__main__":
    import json
    update_tasi()
