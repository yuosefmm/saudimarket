from flask import Flask, jsonify, request
from flask_cors import CORS
import subprocess
import threading
import sys
import os

app = Flask(__name__)
# Enable CORS for all domains to allow fetch from localhost UI
CORS(app) 

# Ensure correct path to python interpreter
PYTHON_EXEC = sys.executable

def run_script(script_name, args=[]):
    """Runs a script in a subprocess and captures output."""
    try:
        cmd = [PYTHON_EXEC, script_name] + args
        print(f"Running command: {cmd}")
        # We start it properly
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=os.getcwd())
        return {
            "success": result.returncode == 0,
            "stdout": result.stdout,
            "stderr": result.stderr
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.route('/api/status', methods=['GET'])
def status():
    return jsonify({"status": "running", "version": "1.0"})

@app.route('/api/update-market', methods=['POST'])
def update_market():
    # Parse args from JSON body if needed, or query params
    # User requested "Last 7 days only"
    days = request.args.get('days', 7) 
    
    # Run fetch_real_data.py
    # This might take time, so ideally we run async, but for simplicity we wait
    # A cleaner way for UI is to return "Started" and let UI poll, but blocking is easier for MVP
    
    print(f"Update Market Request: {days} days")
    
    # We will run it in a thread to not block the server completely, 
    # but since this is a dev tool, blocking is fine-ish. 
    # However, browser timeout is 30s-60s. Fetching all stocks might take longer.
    # We should return "Started" instantly.
    
    def task():
        run_script("fetch_real_data.py", ["--days", str(days)])
        
    threading.Thread(target=task).start()
    
    return jsonify({"message": f"Market update started for last {days} days."})

    return jsonify({"message": f"Market update started for last {days} days."})

if __name__ == '__main__':
    print("Starting Local SWM Server on port 5000...")
    app.run(host='0.0.0.0', port=5000, debug=True)
