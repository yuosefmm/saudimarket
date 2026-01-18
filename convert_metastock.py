import os
import struct
import json
import pandas as pd
import math

# Path to your MetaStock data
input_dir = r"C:\Users\ابو حسان\OneDrive\Desktop\AbuHassan_App\SaudiMarket\SM\Daily\Saudi Stock Exchange-Tadawul"
output_dir = r"C:\Projects\SWM\stock_data_json"

def ms_float(data):
    """
    Convert Microsoft Binary Format (MBF) 4-byte floating point number to Python float.
    """
    if not data or len(data) != 4:
        return 0.0
    
    f = struct.unpack('<4B', data)
    exp = f[3]
    if exp == 0: return 0.0
    
    sign = 1.0
    if (f[2] & 0x80):
        sign = -1.0
        
    mantissa = float(( (f[2] & 0x7F) << 16 ) + (f[1] << 8) + f[0])
    
    val = sign * (1.0 + (mantissa / 8388608.0)) * math.pow(2.0, exp - 129)
    return val

def read_master_legacy(file_path):
    """
    Read legacy MASTER file (53 bytes).
    """
    stocks = {}
    if not os.path.exists(file_path):
        return stocks

    with open(file_path, 'rb') as f:
        f.seek(0, 2)
        size = f.tell()
        f.seek(0)
        num_records = size // 53
        
        for i in range(num_records):
            record = f.read(53)
            if len(record) < 53: break
            
            file_num = record[0]
            if file_num == 0: continue # Skip empty/deleted
            
            symbol_raw = record[7:21]
            symbol = symbol_raw.split(b'\x00')[0].decode('utf-8', errors='ignore').strip()
            
            if symbol:
                stocks[file_num] = {'symbol': symbol, 'name': symbol, 'file_num': file_num}
    return stocks

def read_emaster(file_path):
    """
    Read EMASTER file (192 bytes).
    Offsets based on probe:
    File Num: Offset 2 (Int16?)
    Symbol: Offset 11 (String)
    """
    stocks = {}
    if not os.path.exists(file_path):
        return stocks

    with open(file_path, 'rb') as f:
        f.seek(0, 2)
        size = f.tell()
        f.seek(0)
        num_records = size // 192
        
        print(f"DEBUG: Found {num_records} records in EMASTER")
        
        for i in range(num_records):
            record = f.read(192)
            if len(record) < 192: break
            
            # File Num at offset 2 (2 bytes)
            file_num = struct.unpack('<H', record[2:4])[0]
            
            if file_num == 0: continue
            
            # Symbol at offset 11
            symbol_raw = record[11:25] # Assume ~14 chars max for symbol
            symbol = symbol_raw.split(b'\x00')[0].decode('utf-8', errors='ignore').strip()
            
            # Name at offset 31?
            # name_raw = record[31:47] 
            
            if symbol:
                stocks[file_num] = {
                    'symbol': symbol,
                    'file_num': file_num,
                    'name': symbol # Placeholder, name might be encoded
                }
                
    return stocks

def read_dat_file(file_path):
    """
    Read F*.DAT file.
    Record size: 28 bytes.
    Fields (all MBF float): Date, Open, High, Low, Close, Volume, OpenInt
    """
    records = []
    if not os.path.exists(file_path):
        return records
        
    try:
        with open(file_path, 'rb') as f:
            # Header often 28 bytes or logic based
            # Try reading first 28 bytes
            header = f.read(28) 
            # If file size is tiny, might fail
            
            while True:
                chunk = f.read(28)
                if len(chunk) < 28:
                    break
                
                vals = []
                for i in range(7):
                    val_bytes = chunk[i*4 : (i+1)*4]
                    vals.append(ms_float(val_bytes))
                
                date_float = vals[0]
                date_int = int(date_float)
                
                if date_int < 10000: continue # Invalid date
                
                # YYMMDD format
                year = date_int // 10000
                md = date_int % 10000
                month = md // 100
                day = md % 100
                
                if year < 50: year += 2000
                elif year < 1900: year += 1900
                
                try:
                    date_str = f"{year}-{month:02d}-{day:02d}"
                except:
                    continue
                
                records.append({
                    'date': date_str,
                    'open': vals[1],
                    'high': vals[2],
                    'low': vals[3],
                    'close': vals[4],
                    'volume': int(vals[5])
                })
                
    except Exception as e:
        print(f"Error reading {file_path}: {e}")
        
    return records

def main():
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    emaster_path = os.path.join(input_dir, 'EMASTER')
    master_path = os.path.join(input_dir, 'MASTER')
    
    stocks = {}
    if os.path.exists(emaster_path):
        print(f"Reading EMASTER file: {emaster_path}")
        stocks = read_emaster(emaster_path)
    elif os.path.exists(master_path):
        print(f"Reading MASTER file: {master_path}")
        stocks = read_master_legacy(master_path)
    
    print(f"Found {len(stocks)} symbols to process.")
    
    count = 0
    for file_num, info in stocks.items():
        symbol = info['symbol']
        dat_filename = f"F{file_num}.DAT"
        dat_path = os.path.join(input_dir, dat_filename)
        
        if not os.path.exists(dat_path):
            # print(f"Skipping {symbol}: {dat_filename} not found")
            continue
            
        # Optimization: Only print every 10 or so to avoid buffer latency if massive
        # But for 250 files, printing is fine.
        print(f"[{count+1}/{len(stocks)}] Processing {symbol} ({dat_filename})...")
        
        data = read_dat_file(dat_path)
        if data:
            df = pd.DataFrame(data)
            df.sort_values('date', inplace=True)
            output_file = os.path.join(output_dir, f"{symbol}.json")
            
            with open(output_file, 'w', encoding='utf-8') as jf:
                json.dump(data, jf, indent=2)
            count += 1
            
    print(f"Successfully converted {count} files.")

if __name__ == '__main__':
    main()
