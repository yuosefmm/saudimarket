import yfinance as yf
import pandas as pd
import json
import os
import sys
import time
from datetime import datetime

# Force UTF-8 for console output
try:
    sys.stdout.reconfigure(encoding='utf-8')
except:
    pass

class StockScanner:
    def __init__(self, symbols_file='saudi_symbols.json'):
        self.symbols_file = symbols_file
        self.symbols = self.load_symbols()
        
    def load_symbols(self):
        if not os.path.exists(self.symbols_file):
            print(f"Error: {self.symbols_file} not found.")
            return {}
        with open(self.symbols_file, 'r', encoding='utf-8') as f:
            return json.load(f)

    def calculate_indicators(self, df):
        # Ensure we have enough data
        if len(df) < 50:
            return None

        # 1. Donchian Channel (20)
        # Upper Band = Max High of last 20 candles (excluding today)
        # We shift by 1 so that at index 'i', the window is [i-20, i-1]
        df['Donchian_Upper_20'] = df['High'].shift(1).rolling(window=20).max()
        df['Donchian_Lower_20'] = df['Low'].shift(1).rolling(window=20).min()
        df['Donchian_Middle_20'] = (df['Donchian_Upper_20'] + df['Donchian_Lower_20']) / 2

        # 2. Moving Average (Volume, 10)
        df['Vol_SMA_10'] = df['Volume'].rolling(window=10).mean()

        # 3. Moving Average (Close, 50)
        df['Close_SMA_50'] = df['Close'].rolling(window=50).mean()

        return df

    def check_conditions(self, df):
        if df is None or len(df) == 0:
            return False, {}

        # Get latest candle (today)
        current = df.iloc[-1]
        
        # Check if indicators are valid (not NaN)
        if pd.isna(current['Donchian_Upper_20']) or pd.isna(current['Vol_SMA_10']) or pd.isna(current['Close_SMA_50']):
            return False, {}

        # Condition 1: Close > Donchian Upper Band (20)
        cond1 = current['Close'] > current['Donchian_Upper_20']
        
        # Condition 2: Volume > Volume SMA (10) * 1.5
        cond2 = current['Volume'] > (current['Vol_SMA_10'] * 1.5)
        
        # Condition 3: Close > SMA (50)
        cond3 = current['Close'] > current['Close_SMA_50']

        if cond1 and cond2 and cond3:
            return True, {
                'Close': current['Close'],
                'Volume': current['Volume'],
                'Donchian_Upper': current['Donchian_Upper_20'],
                'Donchian_Middle': current['Donchian_Middle_20'],
                'Vol_SMA_10': current['Vol_SMA_10'],
                'Close_SMA_50': current['Close_SMA_50'],
                'Date': current.name.strftime('%Y-%m-%d')
            }
        
        return False, {}

    def scan(self):
        print(f"Starting Scan on {len(self.symbols)} symbols...", flush=True)
        print("-" * 60)
        
        matches = []
        
        # Iterate over symbols
        # For optimization, we could batch download, but sequential is safer for error handling per stock
        count = 0
        for symbol_id, info in self.symbols.items():
            yf_symbol = info.get('yf_symbol')
            name = info.get('name', symbol_id)
            
            if not yf_symbol:
                continue

            # print(f"Checking {yf_symbol}...", end='\r')
            
            try:
                # Fetch data
                # We need at least 50 days + 20 buffer, so 6mo is safe
                ticker = yf.Ticker(yf_symbol)
                history = ticker.history(period="6mo", interval="1d")
                
                if history.empty:
                    continue

                # Calculate Indicators
                df = self.calculate_indicators(history)
                
                # Check Entry Logic
                is_match, data = self.check_conditions(df)
                
                if is_match:
                    match_info = {
                        'Symbol': symbol_id,
                        'Name': name,
                        'Entry Price': data['Close'],
                        'Stop Loss': data['Donchian_Middle'],
                        'Volume': data['Volume']
                    }
                    matches.append(match_info)
                    print(f"✅ MATCH FOUND: {name} ({symbol_id}) - Price: {data['Close']:.2f}")

            except Exception as e:
                # print(f"Error checking {symbol_id}: {e}")
                pass
            
            count += 1
            if count % 10 == 0:
                print(f"Scanned {count}/{len(self.symbols)}...", end='\r', flush=True)

        print("\n" + "=" * 60)
        print(f"SCAN COMPLETE. Found {len(matches)} matches.")
        print("=" * 60)
        
        if matches:
            print(f"{'Symbol':<10} | {'Name':<20} | {'Entry':<10} | {'Stop Loss':<10}")
            print("-" * 60)
            for m in matches:
                print(f"{m['Symbol']:<10} | {m['Name']:<20} | {m['Entry Price']:<10.2f} | {m['Stop Loss']:<10.2f}")
        else:
            print("No stocks matched the criteria today.")

if __name__ == "__main__":
    scanner = StockScanner()
    scanner.scan()
