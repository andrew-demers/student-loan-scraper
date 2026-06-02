# Nelnet scraper

Personal automation that signs into [Nelnet](https://nelnet.studentaid.gov/) (StudentAid.gov), opens **My Loans**, scrapes each loan group’s **interest rate**, **principal balance**, and **unpaid accrued interest**, prints them to the console, optionally pushes rows to **Google Sheets**, and validates totals against the page’s **current balance**.

This project is not affiliated with or endorsed by Nelnet or the U.S. Department of Education. Use only on your own account and in line with applicable terms of service.

## Requirements

- **Node.js** 18+ (recommended)
- **Chromium** via Playwright (installed by the command below)

## Setup

```bash
cd nelnet-scraper
npm install
npm run install-browsers
cp .env.example .env
```

Edit `.env` with your credentials and optional settings (see below).

## Run

```bash
npm start
```

A **headed** Chromium window opens (`headless: false` in code). After MFA, the script navigates to My Loans, scrolls to load virtualized rows, scrapes groups, runs a balance check, then optionally updates Sheets. It saves **screenshots** under `screenshots/` for debugging.

Press **Enter** in the terminal when prompted to close the browser.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NELNET_USERNAME` | Yes | FSA / Nelnet sign-in username or email |
| `NELNET_PASSWORD` | Yes | Account password |
| `MY_LOANS_URL` | No | Full URL to your My Loans page if auto-navigation fails |
| `GOOGLE_APPLICATION_CREDENTIALS` | No | Path to a Google **service account** JSON key file |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | No | Spreadsheet ID from the sheet's URL |
| `GOOGLE_SHEETS_TAB` | No | Worksheet name (default `Data`) |
| `GMAIL_CLIENT_ID` | No | OAuth2 client ID for Gmail API MFA |
| `GMAIL_CLIENT_SECRET` | No | OAuth2 client secret |
| `GMAIL_REFRESH_TOKEN` | No | Populated automatically by `npm run setup-gmail-auth` |
| `MFA_IMAP_MAX_WAIT_MS` | No | Max ms to wait for the MFA email (default `180000`) |
| `MFA_IMAP_DEBUG` | No | Set to `1` for verbose Gmail API logging |
| `MFA_EMAIL_FROM_CONTAINS` | No | Sender substring filter (default `nelnet`) |
| `MFA_EMAIL_SUBJECT_CONTAINS` | No | Subject substring filter |

If Gmail API is not configured, the script pauses for you to enter the MFA code manually and press Enter in the terminal.

## Gmail API (MFA)

The scraper uses the Gmail API (over HTTPS) to automatically read the Nelnet MFA code from your inbox. This works on corporate networks where IMAP (port 993) is blocked.

**One-time setup:**

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the **Gmail API** (APIs & Services → Library).
2. Create OAuth2 credentials: APIs & Services → Credentials → **Create Credentials → OAuth client ID → Desktop app**. Add `http://localhost:3000` as an authorized redirect URI.
3. Add your Gmail address as a test user: Google Auth Platform → Audience → Test users.
4. Set `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` in `.env`.
5. Run `npm run setup-gmail-auth` — a browser window opens, you authorize, and `GMAIL_REFRESH_TOKEN` is saved to `.env` automatically.

> **Corporate network note:** If you see `unable to get local issuer certificate` errors, run with `NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem npm start`. To make it permanent, add `export NODE_EXTRA_CA_CERTS="$HOME/corp-ca.pem"` to your shell profile after exporting your system keychain: `security find-certificate -a -p /Library/Keychains/System.keychain > ~/corp-ca.pem`.

## Google Sheets

1. In [Google Cloud Console](https://console.cloud.google.com/), enable **Google Sheets API** and create a **service account**.
2. Download the JSON key and point `GOOGLE_APPLICATION_CREDENTIALS` at it (keep it out of git).
3. **Share** the spreadsheet with the service account email (`…@….iam.gserviceaccount.com`) as **Editor**.
4. The **Data** tab is cleared from `A2` through `D2000`, then rows are written with: **Group**, **Interest rate**, **Principal balance**, **Unpaid interest** (columns A–D).

If `GOOGLE_APPLICATION_CREDENTIALS` is unset, the scraper skips Sheets and only logs to the console.

## What gets scraped

- Groups are detected from **“Group: …”** headings and Nelnet `data-cy` attributes, including:
  - `interest-rate-value`
  - `principal-balance-value`
  - `group-unpaid-accrued-interest-value` (unpaid accrued interest)
- Sum of principal + unpaid interest per row is compared to **`current-balance-value`**. A large mismatch triggers a warning and one extra scroll + re-scrape attempt.

## Project layout

| File | Role |
|------|------|
| `scraper.js` | Playwright flow: login, MFA, disclaimer, My Loans, scrape, Sheets |
| `mfa-email.js` | Gmail API polling and OTP extraction from Nelnet email |
| `gmail-auth-setup.js` | One-time OAuth2 setup script — saves refresh token to `.env` |
| `sheets-push.js` | Google Sheets API write |
| `.env.example` | Template for secrets and options |

## Security

- Never commit `.env`, `credentials.json`, or other service account/OAuth keys.
- The Gmail OAuth refresh token grants read access to your inbox — treat it like a password.
- Rotate keys and passwords if they are ever exposed.

