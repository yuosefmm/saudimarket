import yfinance as yf
import pandas as pd
import traceback
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

print(f"Yfinance Version: {yf.__version__}")

try:
    # Setup Robust Session
    session = requests.Session()
    retry = Retry(connect=3, backoff_factor=1, status_forcelist=[500, 502, 503, 504])
    adapter = HTTPAdapter(max_retries=retry)
    session.mount('http://', adapter)
    session.mount('https://', adapter)
    
    print("Attempting to fetch 1010.SR with robust session...")
    ticker = yf.Ticker("1010.SR", session=session)
    # Using the same timeout as the main script
    df = ticker.history(period="2y", interval="1d", timeout=30)
    
    print(f"DF Type: {type(df)}")
    if df is not None:
        if not df.empty:
            print(f"Success! Last Close: {df.iloc[-1]['Close']}")
            print(f"Rows: {len(df)}")
        else:
            print("DF is empty")
            
except Exception:
    traceback.print_exc()
