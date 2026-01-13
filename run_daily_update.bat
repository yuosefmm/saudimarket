@echo off
cd /d "c:\Projects\SWM"

echo [%DATE% %TIME%] Starting Auto Update... >> update_log.txt

echo Running Phase 1: Fetching Data... >> update_log.txt
python fetch_to_json.py >> update_log.txt 2>&1

echo Running Phase 2: Uploading Data... >> update_log.txt
python upload_from_json.py >> update_log.txt 2>&1

echo [%DATE% %TIME%] Update Complete. >> update_log.txt
echo ------------------------------------------ >> update_log.txt
