
import yfinance as yf
import requests
from .config import USER_AGENT, CHUNK_SIZE

def get_yahoo_history(symbol, period='1mo', interval='1d'):
    """
    Fetches historical data for a single symbol using Yahoo Finance internal API (v8).
    This is often more reliable for raw historical data structure than yfinance's history() for deep customization,
    but we can also use yf.Ticker(symbol).history(...) if preferred. 
    
    Using the direct endpoint as in the original script for consistency with known working logic.
    """
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range={period}&interval={interval}"
    headers = {'User-Agent': USER_AGENT}
    
    try:
        r = requests.get(url, headers=headers)
        if r.status_code != 200:
            print(f"      [API Error] {symbol}: Status {r.status_code}")
            return None
        data = r.json()
        
        if not data or 'chart' not in data or not data['chart']['result']:
             return None
             
        return data['chart']['result'][0]
    except Exception as e:
        print(f"      [Exception] Fetching history for {symbol}: {e}")
        return None

def fetch_realtime_batch(symbols):
    """
    Fetches real-time data for a list of symbols using yfinance Tickers (batch processing).
    Returns a dictionary mapping symbol -> info_dict
    """
    if not symbols:
        return {}
        
    # yfinance expects space-separated string
    symbols_str = " ".join(symbols)
    results = {}
    
    try:
        tickers = yf.Tickers(symbols_str)
        
        # Accessing tickers.tickers triggers the download/access
        for yf_sym, ticker in tickers.tickers.items():
            try:
                # fast_info is generally faster and reliable for price
                info = {
                    'price': ticker.fast_info.last_price,
                    'previous_close': ticker.fast_info.previous_close,
                    'year_high': ticker.fast_info.year_high,
                    'year_low': ticker.fast_info.year_low
                }
                results[yf_sym] = info
            except Exception as e:
                # Individual ticker failure shouldn't crash the batch
                # print(f"Error reading info for {yf_sym}: {e}")
                pass
                
    except Exception as e:
        print(f"Batch fetch error: {e}")
        
    return results
