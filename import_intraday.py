import os
import struct
import json
import glob
import datetime

import sys
# Force UTF-8 and Flush
try:
    sys.stdout.reconfigure(encoding='utf-8')
except:
    pass

# CONFIG
SOURCE_BASE = r"C:\Users\ابو حسان\OneDrive\Desktop\AbuHassan_App\SaudiMarket\SM"
OUTPUT_BASE = r"c:\Projects\SWM\public\data\intraday"

# Specific Target Subfolder
TARGET_SUBFOLDER = "Saudi Stock Exchange-Tadawul"

TIMEFRAMES = {
    "1m": "Intraday_1min",
    "15m": "Intraday_15min",
    "30m": "Intraday_30min"
}

def read_master(source_dir):
    """
    Parses MASTER file to map FileNum -> Symbol.
    Legacy MASTER (53 bytes per record).
    """
    # Force target path
    master_path = os.path.join(source_dir, TARGET_SUBFOLDER, "MASTER")
    real_dir = os.path.join(source_dir, TARGET_SUBFOLDER)
    
    if not os.path.exists(master_path):
        print(f"MASTER file not found in {real_dir}")
        return {}, real_dir

    mapping = {}
    
    with open(master_path, "rb") as f:
        while True:
            record = f.read(53)
            if len(record) < 53: break
            
            file_num = record[0]
            
            # Try CP1256 for Arabic Windows
            try:
                symbol = record[7:21].split(b'\x00')[0].decode('cp1256').strip()
                name = record[23:39].split(b'\x00')[0].decode('cp1256').strip()
            except:
                # Fallback
                try:
                    symbol = record[7:21].split(b'\x00')[0].decode('latin1').strip()
                    name = record[23:39].split(b'\x00')[0].decode('latin1').strip()
                except:
                    continue
                
            if symbol and file_num > 0:
                mapping[file_num] = {'symbol': symbol, 'name': name}
                
    return mapping, real_dir

def cvt_mbf(b):
    """Convert Microsoft Binary Format (MBF) 4-byte float to Python float."""
    if not b or len(b) < 4: return 0.0
    if b[3] == 0: return 0.0
    
    # Exponent is at b[3], Bias 128
    exp = b[3] - 128
    
    # Mantissa: b[2] (with sign bit replaced by 1), b[1], b[0]
    sign = 1.0
    mant_b2 = b[2]
    if mant_b2 & 0x80:
        sign = -1.0
        mant_b2 = mant_b2 & 0x7F
    
    # Restore implied leading 1 (MBF stores sign in its place)
    # Actually MBF mantissa is 24 bits with MSB always 1.
    # The MSB is overwritten by sign bit.
    mant_val = ((mant_b2 | 0x80) << 16) | (b[1] << 8) | b[0]
    
    # Value = Mantissa * 2^(Exp - 23) ?
    # MBF: Val = (Mantissa / 2^23) * 2^Exp? 
    # Or Mantissa is integer 24-bit? Yes Mantissa is fraction 1.xxxx
    # So (Mantissa_Int * 2^-23) * 2^Exp
    # = Mantissa_Int * 2^(Exp - 23)
    
    val = mant_val * (2.0 ** (exp - 23))
    return val * sign

def read_dat_file(dat_path):
    """
    Parses F*.DAT file (32 bytes per record for Intraday).
    Fields: Date, Time, Open, High, Low, Close, Volume, OpenInt
    """
    records = []
    
    file_size = os.path.getsize(dat_path)
    # Header is typically 0 or 2 for these files if divisible by 32
    # 786784 % 32 == 0. So Header = 0.
    
    if file_size % 32 != 0:
        # Maybe header size 2? (786784-2) % 32 = 24586.93
        # Maybe header size 28?
        # Let's assume 0 offset for now since it divided perfectly.
        pass
        
    start_offset = 0
        
    with open(dat_path, "rb") as f:
        f.seek(start_offset)
        
        while True:
            chunk = f.read(32)
            if len(chunk) < 32: break
            
            try:
                # Use MBF conversion for all fields
                # 8 floats = 32 bytes
                nums = []
                for i in range(8):
                    nums.append(cvt_mbf(list(chunk[i*4 : (i+1)*4])))
                
                raw_date = int(nums[0]) 
                raw_time = int(nums[1]) # HHMM
                
                s_open = round(nums[2], 2)
                s_high = round(nums[3], 2)
                s_low = round(nums[4], 2)
                s_close = round(nums[5], 2)
                s_vol = int(nums[6])
                
                records.append({
                    'd': raw_date,
                    't': raw_time,
                    'o': s_open,
                    'h': s_high,
                    'l': s_low,
                    'c': s_close,
                    'v': s_vol
                })
                
            except:
                continue
                
    return records

def process_directory(tf_name, source_subdir):
    print(f"Processing {tf_name} from {source_subdir}...", flush=True)
    
    mapping, real_dir = read_master(source_subdir)
    print(f" Found {len(mapping)} symbols in MASTER.", flush=True)
    
    # LOAD SYMBOL MAP
    name_to_ticker = {
        "تاسي": "TASI",
        "المؤشر العام": "TASI",
        "نمو حد أعلى": "NOMUC", # Guessing
    }
    
    try:
        with open("saudi_symbols.json", "r", encoding="utf-8") as f:
            sym_data = json.load(f)
            for k, v in sym_data.items():
                # Normalize name: strip keys
                n = v['name'].strip()
                name_to_ticker[n] = k
                # Also try without spaces just in case
                name_to_ticker[n.replace(" ", "")] = k
                
                # Handle Truncation (Master file limits to 14 bytes/chars)
                # CP1256 uses 1 byte per char mostly.
                if len(n) > 14:
                    trunc = n[:14].strip()
                    name_to_ticker[trunc] = k
                    name_to_ticker[trunc.replace(" ", "")] = k
    except Exception as e:
        print(f"Warning: Could not load saudi_symbols.json: {e}")

    out_dir = os.path.join(OUTPUT_BASE, tf_name)
    if not os.path.exists(out_dir): os.makedirs(out_dir)
    
    count = 0
    for f_num, info in mapping.items():
        symbol = info['symbol'] # this is the Arabic Name in this dataset
        
        # Resolve Ticker
        ticker = symbol
        
        # Try exact match
        if symbol in name_to_ticker:
            ticker = name_to_ticker[symbol]
        else:
            # Try removing spaces
            s_compact = symbol.replace(" ", "")
            if s_compact in name_to_ticker:
                 ticker = name_to_ticker[s_compact]
            else:
                 # Debug missing
                 # print(f"Missing mapping for: {symbol}")
                 pass

        f_name = f"F{f_num}.DAT"
        f_path = os.path.join(real_dir, f_name)
        
        if not os.path.exists(f_path): continue
        
        raw_data = read_dat_file(f_path)
        
        if not raw_data: continue
        
        # Convert to JSON format [ { time: unix, open... } ]
        
        clean_data = []
        for r in raw_data:
            # Parse Date
            # 1260117
            valid = False
            try:
                # Conversion Fix: Data appears to be doubled (2520230 -> 1260115)
                # Likely an artifact of the MBF conversion or file format specific to this vendor
                raw_d = int(r['d'] / 2)
                raw_t = int(r['t'] / 2)
                
                s_d = str(raw_d)
                
                year, month, day = 0, 0, 0
                    
                if len(s_d) == 7: # 1YYMMDD
                    year = 1900 + int(s_d[0:3])
                    month = int(s_d[3:5])
                    day = int(s_d[5:7])
                elif len(s_d) == 6: # YYMMDD
                    yr = int(s_d[0:2])
                    if yr > 50: year = 1900 + yr
                    else: year = 2000 + yr
                    month = int(s_d[2:4])
                    day = int(s_d[4:6])
                else:
                    if raw_d > 20000000: # YYYYMMDD
                        year = int(s_d[0:4])
                        month = int(s_d[4:6])
                        day = int(s_d[6:8])
                    else:
                        continue 
                        
                # Time HHMM
                s_t = str(raw_t).zfill(4) # 0930 -> 0930 (or 142700 -> 1427)
                
                if len(s_t) >= 5: # 142700
                        hour = int(s_t[0:2])
                        minute = int(s_t[2:4])
                else:
                        hour = int(s_t[0:2])
                        minute = int(s_t[2:4])
                
                # Create epoch
                dt = datetime.datetime(year, month, day, hour, minute)
                ts = int(dt.timestamp())
                    
                clean_data.append({
                    'time': ts,
                    'open': r['o'] / 2,
                    'high': r['h'] / 2,
                    'low': r['l'] / 2,
                    'close': r['c'] / 2,
                    'volume': r['v'] / 2
                })
                valid = True
            except:
                pass
                
        if clean_data:
            # Sanitize Symbol for Filename
            # If ticker found, use it directly. Else fallback to safe_symbol
            if ticker != symbol:
                 safe_symbol = ticker
            else:
                 safe_symbol = "".join([c for c in symbol if c.isalnum() or c in ('-', '_', '.')])
            
            if not safe_symbol: safe_symbol = f"UNKNOWN_{f_num}"
            
            out_file = os.path.join(out_dir, f"{safe_symbol}.json")
            try:
                with open(out_file, 'w', encoding='utf-8') as f:
                    json.dump(clean_data, f, separators=(',', ':')) # Compact
                count += 1
            except Exception as e:
                print(f"Failed to write {safe_symbol}: {e}")
            
    print(f" Converted {count} files for {tf_name}.")


def main():
    print("DEBUG: Script Started", flush=True)
    print("Starting Intraday Import (Target: Saudi Stock Exchange-Tadawul)...", flush=True)
    
    # CLEANUP OLD INTRADAY DATA ONLY
    for tf in TIMEFRAMES.keys():
        d = os.path.join(OUTPUT_BASE, tf)
        if os.path.exists(d):
            print(f"Cleaning {d}...", flush=True)
            vals = glob.glob(os.path.join(d, "*.json"))
            for v in vals: os.remove(v)
    
    for tf, folder_name in TIMEFRAMES.items():
        src = os.path.join(SOURCE_BASE, folder_name)
        process_directory(tf, src)
        
    print("All Done.")

if __name__ == "__main__":
    main()
