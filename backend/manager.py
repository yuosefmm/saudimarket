
import json
import time
import os
from datetime import datetime
from .config import CHUNK_SIZE
from .data_source import fetch_realtime_batch, get_yahoo_history
from .storage import update_stock_meta, upload_history_batch

SYMBOLS_FILE = 'saudi_symbols.json'

def load_symbols():
    if not os.path.exists(SYMBOLS_FILE):
        print(f"Error: {SYMBOLS_FILE} not found.")
        return {}
    with open(SYMBOLS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def update_all_prices():
    """
    Fetches real-time data for ALL symbols in chunks and updates Firestore.
    """
    symbols_map = load_symbols()
    if not symbols_map:
        return

    print(f"🚀 Starting Real-Time Update for {len(symbols_map)} symbols...")
    
    # Create list of yf_symbols for batching
    # We need a way to map back yf_symbol -> local_symbol(s)
    # Since multiple local symbols COULD map to same yf_symbol (unlikely but possible), 
    # we'll iterate the map.
    
    all_items = list(symbols_map.items()) # [(id, data), ...]
    
    total_updated = 0
    
    for i in range(0, len(all_items), CHUNK_SIZE):
        chunk = all_items[i:i + CHUNK_SIZE]
        # map: yf_symbol -> local_symbol
        # Note: distinct yf_symbols in this chunk
        yf_to_local = {item[1]['yf_symbol']: item[0] for item in chunk}
        yf_symbols_list = list(yf_to_local.keys())
        
        # print(f"   Fetching chunk {i//CHUNK_SIZE + 1}...")
        results = fetch_realtime_batch(yf_symbols_list)
        
        for yf_sym, info in results.items():
            local_id = yf_to_local.get(yf_sym)
            if not local_id: continue
            
            # Calculate change/percent if we have previous close
            price = info.get('price')
            if price is None: continue
            
            prev_close = info.get('previous_close')
            change = 0.0
            percent = 0.0
            
            if prev_close:
                change = price - prev_close
                percent = (change / prev_close) * 100
                
            data = {
                'price': round(float(price), 2),
                'change': round(float(change), 2),
                'percent': round(float(percent), 2),
                'year_high': round(float(info.get('year_high') or 0), 2),
                'year_low': round(float(info.get('year_low') or 0), 2),
                'lastUpdated': datetime.now(),
                'name': symbols_map[local_id]['name'],
                'symbol': local_id
            }
            
            update_stock_meta(local_id, data)
            total_updated += 1
            
    print(f"✅ Updated {total_updated} stocks.")

def sync_history_for_symbol(symbol_id, period='1mo', should_clear=False):
    """
    Backfills history for a single symbol.
    """
    symbols_map = load_symbols()
    if symbol_id not in symbols_map:
        print(f"Error: Symbol {symbol_id} not found in map.")
        return

    yf_symbol = symbols_map[symbol_id]['yf_symbol']
    # print(f"   Syncing history for {symbol_id} ({yf_symbol}) [{period}]...")
    
    raw_data = get_yahoo_history(yf_symbol, period=period)
    if not raw_data:
        # print(f"      No data found for {symbol_id}")
        return

    # Parse Yahoo internal format (same logic as original fetch_real_data.py)
    timestamps = raw_data.get('timestamp', [])
    quote = raw_data.get('indicators', {}).get('quote', [{}])[0]
    
    opens = quote.get('open', [])
    highs = quote.get('high', [])
    lows = quote.get('low', [])
    closes = quote.get('close', [])
    volumes = quote.get('volume', [])
    
    if not timestamps:
        return

    formatted_data = []
    
    for i in range(len(timestamps)):
        ts = timestamps[i]
        if ts is None: continue
        
        # Check for None in values
        if i >= len(opens) or opens[i] is None: continue
        if i >= len(closes) or closes[i] is None: continue

        dt = datetime.fromtimestamp(ts)
        date_str = dt.strftime('%Y-%m-%d')
        
        # Safe access with defaults
        op = float(opens[i])
        hi = float(highs[i]) if (i < len(highs) and highs[i] is not None) else op
        lo = float(lows[i]) if (i < len(lows) and lows[i] is not None) else op
        cl = float(closes[i])
        # volume might be missing or None
        vol = int(volumes[i]) if (i < len(volumes) and volumes[i] is not None) else 0

        formatted_data.append({
            'time': date_str,
            'open': round(op, 2),
            'high': round(hi, 2),
            'low': round(lo, 2),
            'close': round(cl, 2),
            'volume': vol
        })
        
    if formatted_data:
        count = upload_history_batch(symbol_id, formatted_data, should_clear=should_clear)
        print(f"      {symbol_id}: Synced {count} records.")

def sync_all_history(period='1mo', should_clear=False):
    """
    Syncs history for ALL symbols.
    """
    symbols_map = load_symbols()
    print(f"🚀 Starting Full History Sync for {len(symbols_map)} symbols (Period: {period})...")
    
    for symbol_id in symbols_map:
        try:
            sync_history_for_symbol(symbol_id, period, should_clear)
            # Small sleep to be nice to API
            # time.sleep(0.1) 
        except Exception as e:
            print(f"Error syncing {symbol_id}: {e}")
            
    print("✅ Full History Sync Complete.")
