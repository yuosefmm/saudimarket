import yfinance as yf
import os

# Test without custom CA first
print("Testing yfinance connection...")
try:
    try:
        data = yf.download("1010.SR", period="1d")
        print("Success (default SSL)!")
        print(data)
    except Exception as e:
        print(f"Failed (default SSL): {e}")

    # Test with custom CA if file exists
    if os.path.exists(r"c:\projects\swm\cacert.pem"):
        print("\nTesting with cacert.pem...")
        os.environ["CURL_CA_BUNDLE"] = r"c:\projects\swm\cacert.pem"
        data = yf.download("1010.SR", period="1d")
        print("Success (custom CA)!")
        print(data)
    else:
        print("\ncacert.pem not found, skipping custom CA test.")

except Exception as e:
    print(f"\nCRITICAL ERROR: {e}")
