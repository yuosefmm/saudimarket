import firebase_admin
from firebase_admin import credentials, firestore
import yfinance as yf
from datetime import datetime
import sys
import os
import json

# Fix for SSL if needed
# Fix for SSL if needed (Local Development only)
cacert_path = r"c:\projects\swm\cacert.pem"
if os.path.exists(cacert_path):
    os.environ["CURL_CA_BUNDLE"] = cacert_path

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

def fetch_and_store_news(today_only=False):
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
    
    # Filter for Today Only
    if today_only:
        print("Filtering for Today's news only...")
        today_date = datetime.now().date()
        news_items = [item for item in news_items if item['published'].date() == today_date]
    
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
        # Fallback if no news found (e.g. API limit or issue)
        if count == 0:
            print("Injecting sample news item...")
            sample_item = {
                'title': 'مرحباً بك في صفحة الأخبار (تجريبي)',
                'publisher': 'SWM System',
                'link': '#',
                'published': datetime.now(),
                'uuid': 'sample_001',
                'type': 'system'
            }
            collection.document('sample_001').set(sample_item)
            print("Saved sample item.")
        else:
            print("No new items to save.")

    if len(sys.argv) > 1 and sys.argv[1] == '--today-only':
        today_only = True
    else:
        today_only = False
        
    fetch_and_store_news(today_only=today_only)

