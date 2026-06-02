import { google } from 'googleapis';
import { createServer } from 'http';
import { readFileSync, writeFileSync } from 'fs';
import { config } from 'dotenv';
import { URL } from 'url';

config();

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env first, then re-run.');
  process.exit(1);
}

const REDIRECT_URI = 'http://localhost:3000';
const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/gmail.readonly'],
  prompt: 'consent',
});

console.log('\nOpen this URL in your browser:\n');
console.log(authUrl + '\n');
console.log('Waiting for authorization on http://localhost:3000 ...\n');

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3000');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(`<h2>Authorization failed: ${error ?? 'no code received'}</h2>`);
    console.error('Authorization failed:', error ?? 'no code');
    server.close();
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end('<h2>No refresh token returned. Revoke access at https://myaccount.google.com/permissions and try again.</h2>');
      console.error('No refresh token. Revoke app access at https://myaccount.google.com/permissions and re-run.');
      server.close();
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>Authorization successful! You can close this tab.</h2>');

    let env = readFileSync('.env', 'utf8');
    if (env.includes('GMAIL_REFRESH_TOKEN=')) {
      env = env.replace(/GMAIL_REFRESH_TOKEN=.*/, `GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
    } else {
      env = env.trimEnd() + `\nGMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`;
    }
    writeFileSync('.env', env);

    console.log('GMAIL_REFRESH_TOKEN saved to .env');
    console.log('\nSetup complete. Run npm start to use Gmail API for MFA.');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h2>Error: ${err.message}</h2>`);
    console.error('Token exchange error:', err.message);
  }

  server.close();
});

server.listen(3000, () => console.log('Listening on http://localhost:3000'));
