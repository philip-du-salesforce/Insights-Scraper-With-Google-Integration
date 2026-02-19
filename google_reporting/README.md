# Google Sheets Report Uploader

Python workflow that takes your Insights Scraper output folder, copies a Google Sheet template, renames it, shares it, and uploads the scraped data.

## Seamless flow (extension → upload with no terminal)

To have the **Chrome extension automatically trigger the upload** when extraction completes:

1. Start the trigger server once (keep it running):  
   `python upload_trigger_server.py`
2. Use the extension as usual. When extraction finishes, the upload runs automatically.

See **[SEAMLESS_UPLOAD.md](SEAMLESS_UPLOAD.md)** for full setup and options.

## Quick start (manual run)

1. **Configure Google Cloud** (one-time): See [GOOGLE_OAUTH_SETUP.md](../GOOGLE_OAUTH_SETUP.md) in the project root for:
   - Enabling Drive API and Sheets API
   - Creating OAuth 2.0 Desktop credentials
   - Saving `credentials.json` in this folder

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Run after scraping**

   Scraper output lives on your **Desktop** in folders named `CustomerName_YYYY-MM-DD` (e.g. `NEOS_Life_2026-02-18`). Pass that folder path:

   ```bash
   python google_sheets_uploader.py ~/Desktop/NEOS_Life_2026-02-18
   ```

   Or use the full path:
   ```bash
   python google_sheets_uploader.py /Users/philip.du/Desktop/NEOS_Life_2026-02-18
   ```

   On first run, a browser will open for Google sign-in. The new report is created, shared with the configured email, and data is written to the first sheet. The customer name (e.g. **NEOS_Life**) is taken from the folder name for the report title.

## Options

- `--customer-name "Acme"` – Override customer name (default: from folder name).
- `--no-upload` – Only parse the folder and print a summary; no Drive/Sheets calls.

## Config

Edit `config.py` or set environment variables (see GOOGLE_OAUTH_SETUP.md). Defaults:

- **Template ID:** `1u17hAmhV87-EfBK5IvXaAZzGGK6PNLwaL42kKQk8Djk`
- **Share email:** `philip.du@salesforce.com` (Editor)
- **Report title:** `[Customer Name] Security and Storage Report - [Month] [Year]`

## Data mapping

The script parses all `.txt` module files in the scraper folder (e.g. `1_licenses.txt`, `2_profiles.txt`, `4_health_check.txt`) and writes each module’s tabular block to the first sheet of the new spreadsheet, one section after another. If your template uses multiple sheets or specific ranges, you can adapt `write_tables_to_sheet()` in `google_sheets_uploader.py` to match.
