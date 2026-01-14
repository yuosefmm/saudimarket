import firebase_admin
from firebase_admin import credentials, firestore
import yfinance as yf
from datetime import datetime
import sys
import os
import json

# Fix for SSL if needed
os.environ["CURL_CA_BUNDLE"] = r"c:\projects\swm\cacert.pem"

# Initialize Firebase
if not firebase_admin._apps:
    try:
        # Check if running in GitHub Actions (env var) or local
        if os.getenv('SERVICE_ACCOUNT_KEY'):
             cred = credentials.Certificate(json.loads(os.getenv('SERVICE_ACCOUNT_KEY')))
        else:
            cred = credentials.Certificate('serviceAccountKey.json')
            
        firebase_admin.initialize_app(cred)
    except Exception as e:
        print(f"Error initializing Firebase: {e}")
        #sys.exit(1) # Don't strict exit, maybe fallback
        pass

db = firestore.client()

def fetch_and_store_news():
    print("Fetching News...")
    
    # We can fetch news from TASI and maybe some major movers
    tickers_to_check = ['^TASI.SR', '2222.SR', '1120.SR'] # TASI, Aramco, Rajhi
    
    news_items = []
    seen_links = set()

    for symbol in tickers_to_check:
        try:
            print(f"  Checking {symbol}...")
            ticker = yf.Ticker(symbol)
            news = ticker.news
            
            for item in news:
                link = item.get('link')
                if link in seen_links:
                    continue
                
                seen_links.add(link)
                
                # Convert timestamp
                pub_time = datetime.now()
                if 'providerPublishTime' in item:
                    pub_time = datetime.fromtimestamp(item['providerPublishTime'])
                
                news_items.append({
                    'title': item.get('title'),
                    'publisher': item.get('publisher'),
                    'link': link,
                    'published': pub_time,
                    'uuid': item.get('uuid'),
                    'type': item.get('type')
                })
        except Exception as e:
            print(f"  Error fetching {symbol}: {e}")

    # Sort by date
    news_items.sort(key=lambda x: x['published'], reverse=True)
    
    print(f"Found {len(news_items)} unique news items.")

    # Store in Firestore
    batch = db.batch()
    collection = db.collection('news')
    
    count = 0
    for item in news_items:
        # Use UUID or Link hash as ID to prevent duplicates
        doc_id = item.get('uuid') or str(abs(hash(item['link'])))
        doc_ref = collection.document(doc_id)
        batch.set(doc_ref, item, merge=True)
        count += 1
    
    if count > 0:
        batch.commit()
        print(f"Saved {count} items to Firestore.")
    else:
        print("No new items to save.")

if __name__ == "__main__":
    fetch_and_store_news()
