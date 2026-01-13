
import firebase_admin
from firebase_admin import credentials, firestore
import sys
import os

# --- Configuration Constants ---
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
BATCH_SIZE = 400  # Firestore write batch limit
CHUNK_SIZE = 50   # Number of tickers to fetch at once from Yahoo Finance
SERVICE_ACCOUNT_KEY = 'serviceAccountKey.json'
CACERT_PATH = r"c:\projects\swm\cacert.pem"

# --- Environment Setup ---
# Force UTF-8 for console output
try:
    sys.stdout.reconfigure(encoding='utf-8')
except:
    pass

# Fix for SSL error if needed
if os.path.exists(CACERT_PATH):
    os.environ["CURL_CA_BUNDLE"] = CACERT_PATH

# --- Firebase Initialization Singleton ---
_db_client = None

def get_db():
    global _db_client
    if _db_client is None:
        try:
            if not firebase_admin._apps:
                if not os.path.exists(SERVICE_ACCOUNT_KEY):
                     raise FileNotFoundError(f"Could not find {SERVICE_ACCOUNT_KEY}. Please ensure it is in the project root.")
                
                cred = credentials.Certificate(SERVICE_ACCOUNT_KEY)
                firebase_admin.initialize_app(cred)
            
            _db_client = firestore.client()
            print("✅ Connected to Firebase Firestore")
        except Exception as e:
            print(f"❌ Error initializing Firebase: {e}")
            sys.exit(1)
            
    return _db_client
