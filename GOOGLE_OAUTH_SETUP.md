# Google OAuth 2.0 and Sheets Integration Setup

This guide walks you through enabling Google Drive and Sheets APIs and configuring OAuth so the `google_reporting` script can copy your report template, rename it, share it, and upload scraped data.

---

## 1. Google Cloud Console – Enable APIs

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Select your project (or create one).
3. Open **APIs & Services** → **Library**.
4. Enable these two APIs:
   - **Google Drive API** – for copying the template and sharing the new file.
   - **Google Sheets API** – for writing data to the new spreadsheet.
5. Confirm both show as “Enabled” under **APIs & Services** → **Enabled APIs**.

---

## 2. Create OAuth 2.0 Credentials (Desktop App)

1. In Google Cloud Console go to **APIs & Services** → **Credentials**.
2. Click **Create Credentials** → **OAuth client ID**.
3. If prompted, set the **OAuth consent screen**:
   - User type: **Internal** (for org-only) or **External** (for any Google account).
   - Fill App name, User support email, Developer contact.
   - Scopes: add  
     `https://www.googleapis.com/auth/drive`  
     and  
     `https://www.googleapis.com/auth/spreadsheets`  
     (or they will be requested by the script).
   - Save.
4. Back under **Credentials**, create the OAuth client:
   - Application type: **Desktop app**.
   - Name: e.g. “Insights Scraper Report Uploader”.
   - Click **Create**.
5. Copy the **Client ID** and **Client secret** (you’ll need the secret for the next step).

---

## 3. Add Credentials to the Project

The script expects a file named `credentials.json` in the `google_reporting` folder, in the format Google provides when you **Download JSON** from the OAuth client:

1. In **Credentials**, open your OAuth 2.0 Client ID.
2. Click **Download JSON** (or copy Client ID and Client secret manually).
3. Place the file in:
   ```
   Insights-Scraper-master/google_reporting/credentials.json
   ```
   If you used “Download JSON”, you can rename the downloaded file to `credentials.json` and put it there.

**If you only have Client ID and Client secret (no JSON):**

- Use the example structure in `google_reporting/credentials.example.json`.
- Replace `YOUR_CLIENT_SECRET_FROM_GOOGLE_CLOUD_CONSOLE` with your real **Client secret**.
- Save as `google_reporting/credentials.json`.

**Security:**  
- Do **not** commit `credentials.json` or `token.json` to version control.  
- They are listed in `.gitignore` for the `google_reporting` folder.

---

## 4. Template Spreadsheet and Share Email

Already configured in `google_reporting/config.py` (or via environment variables):

- **Template Spreadsheet ID:** `1u17hAmhV87-EfBK5IvXaAZzGGK6PNLwaL42kKQk8Djk`
- **Share email:** `philip.du@salesforce.com` (as Editor)

To override without editing code, set:

- `GOOGLE_TEMPLATE_SPREADSHEET_ID`
- `GOOGLE_REPORT_SHARE_EMAIL`

---

## 5. First Run (Token Retrieval)

1. Install dependencies:
   ```bash
   cd google_reporting
   pip install -r requirements.txt
   ```
2. Run the uploader with a scraper output folder:
   ```bash
   python google_sheets_uploader.py /path/to/CustomerName_2026-02-19
   ```
3. On first run, a browser window will open for Google sign-in. Log in and approve the requested scopes (Drive and Sheets).
4. After approval, credentials are stored in `google_reporting/token.json`. Later runs will use this token until it expires (then the script will refresh or prompt again).

---

## 6. Manual Steps Summary

| Step | Action |
|------|--------|
| 1 | Enable **Google Drive API** and **Google Sheets API** in Cloud Console. |
| 2 | Create **OAuth 2.0 Desktop** credentials; note Client ID and Client secret. |
| 3 | Configure OAuth consent screen and add Drive + Sheets scopes if required. |
| 4 | Place `credentials.json` in `google_reporting/` (from downloaded JSON or from `credentials.example.json` with your client secret). |
| 5 | Run the script once and complete the browser sign-in to generate `token.json`. |

---

## 7. Optional: Environment Variables

You can override config without editing files:

- `GOOGLE_CREDENTIALS_PATH` – path to `credentials.json`
- `GOOGLE_TOKEN_PATH` – path to `token.json`
- `GOOGLE_CLIENT_ID` – OAuth client ID (if not using a credentials file)
- `GOOGLE_TEMPLATE_SPREADSHEET_ID` – template spreadsheet ID
- `GOOGLE_REPORT_SHARE_EMAIL` – email to share the new report with

---

## 8. Troubleshooting

- **“Credentials file not found”**  
  Ensure `credentials.json` exists in `google_reporting/` and contains valid `client_id` and `client_secret` (e.g. under `installed`).

- **“Access blocked” or “App not verified”**  
  For internal apps, add test users on the OAuth consent screen. For external apps, you may need to complete verification or use a test account.

- **“The caller does not have permission”**  
  Ensure both Drive API and Sheets API are enabled and that the account you signed in with has access to the template spreadsheet and is allowed to create files in the target Drive.

- **Token expired**  
  Delete `token.json` and run the script again to sign in again and get a new token.
