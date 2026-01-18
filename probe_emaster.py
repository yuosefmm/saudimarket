import os

emaster_path = r"C:\Users\ابو حسان\OneDrive\Desktop\AbuHassan_App\SaudiMarket\SM\Daily\Saudi Stock Exchange-Tadawul\EMASTER"

def hex_dump(data):
    return " ".join(f"{b:02X}" for b in data)

def printable(data):
    return "".join((chr(b) if 32 <= b <= 126 else '.') for b in data)

if os.path.exists(emaster_path):
    print(f"Reading EMASTER: {emaster_path}")
    with open(emaster_path, 'rb') as f:
        # Read first 3 records (192 bytes each)
        for i in range(3):
            record = f.read(192)
            if not record: break
            print(f"\nRecord {i}:")
            print(f"Hex: {hex_dump(record[:64])}...") # First 64 bytes
            print(f"ASCII: {printable(record)}")
else:
    print("EMASTER not found")
