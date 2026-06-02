import { google } from 'googleapis';
import { Buffer } from 'buffer';

function extractOtpFromText(text) {
  if (!text) return null;
  const flat = text.replace(/\s+/g, ' ');
  const patterns = [
    /\b(\d{6,8})\b/,
    /\b(\d{3}-\d{3})\b/,
    /\b(\d{4}-\d{4})\b/,
    /(?:code|password)[:\s]+(\d{6,8})/i,
    /(?:code|password)[:\s]+(\d{3}-\d{3})/i,
  ];
  for (const re of patterns) {
    const m = flat.match(re);
    if (!m) continue;
    return m[1].replace(/\D/g, '');
  }
  return null;
}

function extractNelnetOtpFromHtml(html) {
  if (!html || typeof html !== 'string') return null;
  const patterns = [
    /<p[^>]*\bh2\b[^>]*\btext-gray\b[^>]*>[\s\S]*?(\d{6,8})[\s\S]*?<\/p>/i,
    /<p[^>]*\btext-gray\b[^>]*\bh2\b[^>]*>[\s\S]*?(\d{6,8})[\s\S]*?<\/p>/i,
    /<p[^>]*class="[^"]*\bh2\b[^"]*\btext-gray\b[^"]*"[^>]*>[\s\S]*?(\d{6,8})/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

function decodeBody(payload) {
  const result = { text: '', html: '' };
  if (!payload) return result;

  if (payload.body?.data) {
    const decoded = Buffer.from(payload.body.data, 'base64url').toString('utf8');
    if (payload.mimeType === 'text/html') result.html = decoded;
    else result.text = decoded;
  }

  for (const part of payload.parts || []) {
    const sub = decodeBody(part);
    result.text += sub.text;
    result.html += sub.html;
  }

  return result;
}

/**
 * Poll Gmail API for a recent Nelnet MFA code. Requires OAuth2 credentials
 * (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN in .env).
 * Run `npm run setup-gmail-auth` once to obtain the refresh token.
 *
 * @param {object} opts
 * @param {string} opts.clientId
 * @param {string} opts.clientSecret
 * @param {string} opts.refreshToken
 * @param {Date} [opts.notBefore]
 * @param {string} [opts.fromContains]
 * @param {string} [opts.subjectContains]
 * @param {number} [opts.maxWaitMs=180000]
 * @param {number} [opts.pollIntervalMs=4000]
 */
export async function waitForEmailCode(opts) {
  const {
    clientId,
    clientSecret,
    refreshToken,
    notBefore = new Date(Date.now() - 3 * 60 * 1000),
    fromContains,
    subjectContains,
    maxWaitMs = 180_000,
    pollIntervalMs = 4000,
    debug = process.env.MFA_IMAP_DEBUG === '1' || process.env.MFA_IMAP_DEBUG === 'true',
  } = opts;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const cutoff = new Date(notBefore.getTime() - 3 * 60 * 1000);
  const afterTs = Math.floor(cutoff.getTime() / 1000);
  const deadline = Date.now() + maxWaitMs;

  const dbg = (...args) => { if (debug) console.error('[mfa-gmail]', ...args); };

  const queryParts = [`after:${afterTs}`];
  if (fromContains?.trim()) queryParts.push(`from:${fromContains.trim()}`);
  if (subjectContains?.trim()) queryParts.push(`subject:${subjectContains.trim()}`);
  const query = queryParts.join(' ');
  dbg('search query:', query);

  while (Date.now() < deadline) {
    try {
      const listRes = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 20 });
      const messages = listRes.data.messages || [];
      dbg(`found ${messages.length} messages`);

      for (const { id } of messages) {
        const msgRes = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
        const msg = msgRes.data;

        const internalDate = new Date(Number(msg.internalDate));
        if (internalDate < cutoff) {
          dbg('skip', id, 'too old:', internalDate.toISOString());
          continue;
        }

        const body = decodeBody(msg.payload);
        let code = extractNelnetOtpFromHtml(body.html);
        if (!code) {
          const combined = [body.text, body.html.replace(/<[^>]+>/g, ' ')].join('\n');
          code = extractOtpFromText(combined);
        }

        if (code && code.length >= 6) {
          dbg('found code in message', id);
          return code;
        }
        dbg('skip', id, 'no code found in body');
      }
    } catch (e) {
      dbg('Gmail API error:', e.message);
      console.error('[mfa-gmail] error:', e.message);
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error('Timed out waiting for a verification code via Gmail API.');
}

export { extractOtpFromText, extractNelnetOtpFromHtml };
