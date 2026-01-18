import requests
import time

url = "https://query2.finance.yahoo.com/v8/finance/chart/1010.SR?range=1d&interval=1d"

print(f"Testing connectivity to: {url}")
start = time.time()

try:
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    response = requests.get(url, headers=headers, timeout=10)
    print(f"Status Code: {response.status_code}")
    print(f"Response Time: {time.time() - start:.2f}s")
    
    if response.status_code == 200:
        print("Success! Data preview:")
        print(response.text[:200])
    else:
        print("Failed to get 200 OK.")
        print(response.text[:500])

except requests.exceptions.Timeout:
    print("ERROR: Connection Timed Out (Blocked?)")
except requests.exceptions.ConnectionError:
    print("ERROR: Connection Error (DNS/Network)")
except Exception as e:
    print(f"ERROR: {e}")
