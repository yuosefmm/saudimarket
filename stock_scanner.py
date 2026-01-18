import pandas as pd
import json
import os
import sys
import glob
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime

# Force UTF-8 for console output
try:
    sys.stdout.reconfigure(encoding='utf-8')
except:
    pass

# SSL Fix for Local Windows Environment
cacert_path = r"c:\projects\swm\cacert.pem"
if os.path.exists(cacert_path):
    os.environ["CURL_CA_BUNDLE"] = cacert_path

DATA_DIR = r"c:\Projects\SWM\public\data"
SYMBOLS_FILE = 'saudi_symbols.json'

def initialize_firebase():
    if not firebase_admin._apps:
        if os.getenv('SERVICE_ACCOUNT_KEY'):
             cred = credentials.Certificate(json.loads(os.getenv('SERVICE_ACCOUNT_KEY')))
        else:
            cred = credentials.Certificate('serviceAccountKey.json')
        firebase_admin.initialize_app(cred)
    return firestore.client()

class StockScanner:
    def __init__(self):
        self.db = initialize_firebase()
        self.symbols_map = self.load_symbols()
        
    def load_symbols(self):
        try:
            with open(SYMBOLS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            return {}

    def load_local_data(self, json_path):
        """Loads JSON data into a Pandas DataFrame."""
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
            if not data: return None
            
            # Data format: list of dicts {date, open, high, low, close, volume}
            df = pd.DataFrame(data)
            
            # Ensure safe numeric conversion
            cols = ['open', 'high', 'low', 'close', 'volume']
            for c in cols:
                df[c] = pd.to_numeric(df[c], errors='coerce')
                
            # Date Parsing (Handle various formats)
            if 'date' in df.columns:
                df['Date'] = pd.to_datetime(df['date'], errors='coerce')
            elif 'time' in df.columns:
                if df['time'].dtype == 'int64' or df['time'].dtype == 'float64':
                     df['Date'] = pd.to_datetime(df['time'], unit='s')
                else:
                     df['Date'] = pd.to_datetime(df['time'], errors='coerce')
            
            df.sort_values('Date', inplace=True)
            df.set_index('Date', inplace=True)
            return df
        except Exception as e:
            return None

    def calculate_indicators(self, df):
        if len(df) < 50: return None

        # 1. Donchian Channel (20) - Shifted 1
        df['Donchian_Upper_20'] = df['high'].shift(1).rolling(window=20).max()
        df['Donchian_Lower_20'] = df['low'].shift(1).rolling(window=20).min()
        df['Donchian_Middle_20'] = (df['Donchian_Upper_20'] + df['Donchian_Lower_20']) / 2

        # 2. Volume SMA (10)
        df['Vol_SMA_10'] = df['volume'].rolling(window=10).mean()

        # 3. SMA (50)
        df['Close_SMA_50'] = df['close'].rolling(window=50).mean()

        return df

    def check_conditions(self, df):
        if df is None or len(df) < 1: return False, {}

        curr = df.iloc[-1]
        
        if pd.isna(curr['Donchian_Upper_20']) or pd.isna(curr['Vol_SMA_10']): return False, {}

        cond1 = curr['close'] > curr['Donchian_Upper_20']
        cond2 = curr['volume'] > (curr['Vol_SMA_10'] * 1.5)
        cond3 = curr['close'] > curr['Close_SMA_50']
        
        if cond1 and cond2 and cond3:
             return True, {
                'Close': curr['close'],
                'Stop Loss': curr['Donchian_Middle_20'],
                'Volume': curr['volume']
             }
        
        return False, {}

    def calculate_intraday_indicators(self, df):
        if len(df) < 50: return None
        
        # RSI 14
        delta = df['close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / loss
        df['rsi'] = 100 - (100 / (1 + rs))

        # VWAP (Rolling 20 for intraday proxy)
        df['tp'] = (df['high'] + df['low'] + df['close']) / 3
        df['vwap'] = (df['tp'] * df['volume']).rolling(20).sum() / df['volume'].rolling(20).sum()
        
        return df

    def check_intraday_strategies(self, df):
        if df is None or len(df) < 5: return {}
        
        flags = {}
        curr = df.iloc[-1]
        prev = df.iloc[-2]
        prev2 = df.iloc[-3]
        
        # 1. Morning Star (Bearish, Small Body, Bullish)
        is_c1_red = prev2['close'] < prev2['open']
        body1 = abs(prev2['close'] - prev2['open'])
        
        body2 = abs(prev['close'] - prev['open'])
        is_c2_small = body2 < (body1 * 0.4)
        
        is_c3_green = curr['close'] > curr['open']
        midpoint_c1 = (prev2['close'] + prev2['open']) / 2
        is_c3_piercing = curr['close'] > midpoint_c1
        
        flags['strategy_morning_star'] = bool(is_c1_red and is_c2_small and is_c3_green and is_c3_piercing)
        
        # 2. VWAP Bounce
        if not pd.isna(curr.get('vwap')):
            dist = abs(curr['low'] - curr['vwap']) / curr['vwap']
            touched = dist < 0.005
            bounced = (curr['close'] > curr['vwap']) and (curr['close'] > curr['open'])
            vol_supp = curr['volume'] > df['volume'].rolling(20).mean().iloc[-1]
            flags['strategy_vwap_bounce'] = bool(touched and bounced and vol_supp)
        else:
            flags['strategy_vwap_bounce'] = False
            
        # 3. RSI Divergence (Bullish) - 15m
        if not pd.isna(curr.get('rsi')):
            slice_df = df.iloc[-30:]
            min_price_idx = slice_df['low'].idxmin()
            min_price = slice_df.loc[min_price_idx]['low']
            rsi_at_min = slice_df.loc[min_price_idx]['rsi']
            
            prev_min = df['low'].iloc[-30:-1].min()
            is_lower_low = curr['low'] <= prev_min * 1.002
            is_higher_rsi = curr['rsi'] > (rsi_at_min + 3)
            is_oversold = curr['rsi'] < 40
            
            flags['strategy_bullish_div'] = bool(is_lower_low and is_higher_rsi and is_oversold)
        else:
            flags['strategy_bullish_div'] = False
            
        return flags

    def get_stock_name(self, symbol):
        if symbol in self.symbols_map:
            return self.symbols_map[symbol].get('name', symbol)
        if symbol == 'TASI': return 'المؤشر العام'
        return symbol

    def reset_firestore_flags(self):
        print("Resetting old strategy flags in Firestore...", end='', flush=True)
        try:
            # Batch update is limited to 500, but we have ~250 stocks so it's fine in one go or loop
            docs = self.db.collection('stocks').where('strategy_donchian_breakout', '==', True).stream()
            batch = self.db.batch()
            count = 0
            for doc in docs:
                batch.update(doc.reference, {
                    'strategy_donchian_breakout': False,
                    'lastUpdated': firestore.SERVER_TIMESTAMP
                })
                count += 1
            
            if count > 0:
                batch.commit()
            print(f" Done. Reset {count} stocks.")
        except Exception as e:
            print(f" Error resetting flags: {e}")

    def update_firestore_match(self, symbol, data):
        try:
            doc_ref = self.db.collection('stocks').document(symbol)
            doc_ref.set({
                'strategy_donchian_breakout': True,
                'donchian_entry': float(data['Close']),
                'donchian_stop_loss': float(data['Stop Loss']),
                'lastUpdated': firestore.SERVER_TIMESTAMP
            }, merge=True)
        except Exception as e:
            print(f"Failed to update Firestore for {symbol}: {e}")

    def scan_intraday(self):
        print("\nStarting Intraday Scan (15m)...")
        INTRADAY_DIR = os.path.join(DATA_DIR, "intraday", "15m")
        if not os.path.exists(INTRADAY_DIR):
            print(f"Intraday directory not found: {INTRADAY_DIR}")
            return

        files = glob.glob(os.path.join(INTRADAY_DIR, "*.json"))
        print(f"Scanning {len(files)} files in 15m...", flush=True)
        
        matches_count = {'morning_star':0, 'vwap':0, 'div':0}
        updates_to_commit = []
        
        # 1. SCANNING PHASE (CPU/Disk Only)
        print("PHASE 1: Processing Local Files...", flush=True)
        for i, file_path in enumerate(files):
            symbol = os.path.basename(file_path).replace('.json', '')
            
            if i % 50 == 0:
                print(f"  Scanned {i}/{len(files)}...", flush=True)
            
            try:
                df = self.load_local_data(file_path)
                if df is None: continue
                
                df = self.calculate_intraday_indicators(df)
                if df is None: continue
                
                flags = self.check_intraday_strategies(df)
                
                if any(flags.values()):
                    if flags.get('strategy_morning_star'): matches_count['morning_star'] += 1
                    if flags.get('strategy_vwap_bounce'): matches_count['vwap'] += 1
                    if flags.get('strategy_bullish_div'): matches_count['div'] += 1
                    
                    update_data = {
                        'strategy_morning_star': flags.get('strategy_morning_star', False),
                        'strategy_vwap_bounce': flags.get('strategy_vwap_bounce', False),
                        'strategy_bullish_div': flags.get('strategy_bullish_div', False),
                    }
                    updates_to_commit.append({'symbol': symbol, 'data': update_data})
                    
            except Exception as e:
                print(f"  Error reading {symbol}: {e}", flush=True)
                continue
        
        print(f"  Scan Complete. Found {len(updates_to_commit)} updates needed.", flush=True)
        print("-" * 40)

        # 2. UPLOAD PHASE (Network Only)
        if updates_to_commit:
            print("PHASE 2: Uploading to Firestore in batches of 50...", flush=True)
            batch = self.db.batch()
            batch_count = 0
            total_uploaded = 0
            
            for item in updates_to_commit:
                doc_ref = self.db.collection('stocks').document(item['symbol'])
                batch.update(doc_ref, item['data'])
                batch_count += 1
                
                if batch_count >= 50:
                    print(f"  Committing batch (Total: {total_uploaded + batch_count})...", end='', flush=True)
                    try:
                        batch.commit()
                        print(" OK", flush=True)
                    except Exception as e:
                        print(f" FAILED: {e}", flush=True)
                        
                    batch = self.db.batch()
                    total_uploaded += batch_count
                    batch_count = 0
                    
            if batch_count > 0:
                print(f"  Committing final batch ({batch_count})...", end='', flush=True)
                try:
                    batch.commit()
                    print(" OK", flush=True)
                except Exception as e:
                     print(f" FAILED: {e}", flush=True)
                     
        print("-" * 40)
        print(f"Intraday Scan Complete.")
        print(f"Morning Star: {matches_count['morning_star']}")
        print(f"VWAP Bounce: {matches_count['vwap']}")
        print(f"Bullish Div: {matches_count['div']}")

    def scan(self):
        print("Starting Local Scan (Donchian Strategy)...")
        
        # 1. Reset Old Matches
        self.reset_firestore_flags()
        
        files = glob.glob(os.path.join(DATA_DIR, "*.json"))
        print(f"Scanning {len(files)} local files...")
        print("-" * 60)
        
        matches = []
        
        for file_path in files:
            symbol = os.path.basename(file_path).replace('.json', '')
            
            df = self.load_local_data(file_path)
            if df is None: continue
            
            df = self.calculate_indicators(df)
            if df is None: continue
            
            is_match, data = self.check_conditions(df)
            
            if is_match:
                name = self.get_stock_name(symbol)
                matches.append({
                    'Symbol': symbol,
                    'Name': name,
                    'Entry Price': data['Close'],
                    'Stop Loss': data.get('Stop Loss', 0),
                    'Volume': data['Volume']
                })
                print(f"✅ MATCH: {name} ({symbol}) - {data['Close']:.2f}")
                
                # 2. Upload Match to Firestore
                self.update_firestore_match(symbol, data)

        print("=" * 60)
        print(f"SCAN COMPLETE. Found {len(matches)} matches.")
        
        if matches:
            print(f"{'Symbol':<10} | {'Name':<20} | {'Entry':<10} | {'Stop Loss':<10}")
            print("-" * 60)
            for m in matches:
                print(f"{m['Symbol']:<10} | {m['Name']:<20} | {m['Entry Price']:<10.2f} | {m['Stop Loss']:<10.2f}")
        else:
            print("No matches found.")
            
        self.scan_intraday()

if __name__ == "__main__":
    scanner = StockScanner()
    scanner.scan()
