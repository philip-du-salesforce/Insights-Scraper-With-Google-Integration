# Seamless Flow: Extension → Google Sheets (No Terminal Step)

After extraction finishes in the Chrome extension, the Google Sheets upload can run **automatically** so you don’t have to open a terminal and run the Python script yourself.

## One-time setup

1. **Configure Google OAuth**  
   Follow [GOOGLE_OAUTH_SETUP.md](../GOOGLE_OAUTH_SETUP.md) so `credentials.json` and (after first run) `token.json` exist in `google_reporting/`.

2. **Start the trigger server (once per session)**  
   In a terminal, from the project root:
   ```bash
   cd google_reporting
   python upload_trigger_server.py
   ```
   Leave this running (minimize the terminal or run in the background).  
   Optional: run on a different port with `python upload_trigger_server.py --port 9000` (you’d then need to change the port in the extension code to match).

3. **Extension option**  
   In the extension popup, leave **“Auto-upload to Google Sheets when extraction completes”** checked (default). To turn off automatic upload, uncheck it.

## Normal workflow

1. Start the trigger server (step 2 above) if it isn’t already running.
2. Open Salesforce in Chrome and use the extension: choose modules and click **Run Script**.
3. Wait for extraction to finish (files download to your chosen folder, e.g. Desktop).
4. When extraction completes, the extension calls the trigger server, which runs the uploader. No need to open a terminal or run any command.
5. In the popup, you’ll see either “Google Sheets: Upload completed” with a link to the new spreadsheet, or a short message if the server wasn’t reached or the upload failed.

## Where files are looked up

The trigger server looks for the extraction folder in:

1. `~/Desktop/<CustomerName_YYYY-MM-DD>`
2. `~/Downloads/<CustomerName_YYYY-MM-DD>`

Use the same folder name the extension uses (customer name + date). If your downloads go to Desktop, the server will find them there.

## If you don’t run the trigger server

- Auto-upload will not run. The popup will show a message like “Trigger server not reached.”
- You can still upload manually:
  ```bash
  cd google_reporting
  python google_sheets_uploader.py ~/Desktop/CustomerName_2026-02-19
  ```

## Summary

| Step | Action |
|------|--------|
| Once | Configure OAuth (`credentials.json`, then sign in to get `token.json`) |
| Once per session | Run `python google_reporting/upload_trigger_server.py` and leave it running |
| Each run | Use the extension to extract; when it finishes, the upload runs automatically |
