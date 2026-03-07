const fs = require('fs');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, '..', '..', 'config', 'credentials', 'google_credentials.json');
const TOKEN_PATH = path.join(__dirname, '..', '..', 'config', 'credentials', 'google_token.json');

// --- Configuration Constants ---
const MAX_TRIAGE_CANDIDATES = 100;
const MAX_DEEP_READ = 5;
const MAX_EXPANDED_THREADS = 2;
const MAX_MESSAGES_PER_THREAD = 15;
const MAX_THREAD_CHARS = 8000;
const TRIAGE_WINDOW_HOURS = 72;

// --- Session cache ---
let cachedEmailContext = null;

function isConfigured() {
  return fs.existsSync(CREDENTIALS_PATH) && fs.existsSync(TOKEN_PATH);
}

async function getAuth() {
  const { google } = require('googleapis');
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));

  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;
  const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  auth.setCredentials(token);

  if (token.expiry_date && token.expiry_date < Date.now()) {
    const { credentials: newCreds } = await auth.refreshAccessToken();
    auth.setCredentials(newCreds);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(newCreds), 'utf-8');
  }

  return auth;
}

function getGmailClient(auth) {
  const { google } = require('googleapis');
  return google.gmail({ version: 'v1', auth });
}

// --- Layer 1: Cheap Triage ---

async function fetchTriageCandidates() {
  if (!isConfigured()) return null;

  const auth = await getAuth();
  const gmail = getGmailClient(auth);

  const windowStart = Math.floor((Date.now() - TRIAGE_WINDOW_HOURS * 60 * 60 * 1000) / 1000);
  const query = `after:${windowStart}`;

  const candidates = [];
  let pageToken = null;

  // Paginate up to MAX_TRIAGE_CANDIDATES
  do {
    const listParams = {
      userId: 'me',
      q: query,
      maxResults: Math.min(50, MAX_TRIAGE_CANDIDATES - candidates.length),
    };
    if (pageToken) listParams.pageToken = pageToken;

    const listResponse = await gmail.users.messages.list(listParams);
    const messages = listResponse.data.messages || [];
    pageToken = listResponse.data.nextPageToken || null;

    // Fetch metadata for each message in this page
    for (const msg of messages) {
      if (candidates.length >= MAX_TRIAGE_CANDIDATES) break;

      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });

      const headers = detail.data.payload.headers;
      const from = headers.find((h) => h.name === 'From')?.value || 'Unknown';
      const subject = headers.find((h) => h.name === 'Subject')?.value || 'No subject';
      const date = headers.find((h) => h.name === 'Date')?.value || '';
      const snippet = detail.data.snippet || '';
      const threadId = detail.data.threadId;
      const labelIds = detail.data.labelIds || [];
      const isUnread = labelIds.includes('UNREAD');

      candidates.push({
        id: msg.id,
        threadId,
        from,
        subject,
        date,
        snippet,
        labelIds,
        isUnread,
        score: 0,
      });
    }

    if (candidates.length >= MAX_TRIAGE_CANDIDATES) break;
  } while (pageToken);

  // Get actual unread count
  const labels = await gmail.users.labels.get({ userId: 'me', id: 'INBOX' });
  const unreadCount = labels.data.messagesUnread || 0;

  return { candidates, unreadCount, gmail, auth };
}

// --- Layer 2: Goal-Aware Ranking ---

const LOW_VALUE_PATTERNS = [
  /noreply@/i, /no-reply@/i, /newsletter/i, /unsubscribe/i,
  /marketing@/i, /promo/i, /deals@/i, /offers@/i,
  /notification@/i, /notifications@/i, /digest@/i,
];

const JOB_KEYWORDS = [
  'interview', 'offer', 'application', 'assessment', 'follow-up',
  'recruiter', 'role', 'position', 'salary', 'contract',
  'shortlisted', 'screening', 'hiring', 'onboarding', 'vacancy',
];

function rankEmails(candidates, goals, openActions, recentEntries) {
  // Extract keywords from goals, actions, and entries for matching
  const goalKeywords = new Set();
  for (const g of goals) {
    const data = g.goal_data || {};
    const text = [g.title, data.outcome, data.target_role, data.target_company, data.description]
      .filter(Boolean).join(' ').toLowerCase();
    for (const word of text.split(/\s+/)) {
      if (word.length > 3) goalKeywords.add(word);
    }
  }

  const actionKeywords = new Set();
  for (const a of openActions || []) {
    for (const word of a.description.toLowerCase().split(/\s+/)) {
      if (word.length > 3) actionKeywords.add(word);
    }
  }

  // Count threads to detect active conversations
  const threadCounts = {};
  for (const c of candidates) {
    threadCounts[c.threadId] = (threadCounts[c.threadId] || 0) + 1;
  }

  for (const candidate of candidates) {
    let score = 0;
    const fromLower = candidate.from.toLowerCase();
    const subjectLower = candidate.subject.toLowerCase();
    const snippetLower = candidate.snippet.toLowerCase();
    const combinedText = `${fromLower} ${subjectLower} ${snippetLower}`;

    // Job-related keywords in subject or snippet
    for (const kw of JOB_KEYWORDS) {
      if (subjectLower.includes(kw)) score += 3;
      else if (snippetLower.includes(kw)) score += 1;
    }

    // Goal keyword matches
    for (const kw of goalKeywords) {
      if (combinedText.includes(kw)) { score += 2; break; }
    }

    // Action keyword matches
    for (const kw of actionKeywords) {
      if (combinedText.includes(kw)) { score += 2; break; }
    }

    // Active thread (multiple messages = conversation)
    if (threadCounts[candidate.threadId] > 1) score += 3;

    // Unread bonus
    if (candidate.isUnread) score += 1;

    // Recency bonus (last 24h)
    try {
      const emailDate = new Date(candidate.date);
      if (Date.now() - emailDate.getTime() < 24 * 60 * 60 * 1000) score += 1;
    } catch {}

    // Low-value penalty
    for (const pattern of LOW_VALUE_PATTERNS) {
      if (pattern.test(candidate.from) || pattern.test(candidate.subject)) {
        score -= 5;
        break;
      }
    }

    // Promotional label penalty
    if (candidate.labelIds.includes('CATEGORY_PROMOTIONS') ||
        candidate.labelIds.includes('CATEGORY_SOCIAL') ||
        candidate.labelIds.includes('CATEGORY_UPDATES')) {
      score -= 3;
    }

    candidate.score = score;
  }

  // Sort descending by score
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

// --- Layer 3: Selective Deep Read ---

function decodeBody(payload) {
  // Try to extract plain text body, fall back to HTML decoded to text
  if (!payload) return '';

  // Check for simple body
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  // Check parts
  if (payload.parts) {
    // Prefer plain text
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
    }
    // Fall back to HTML, strip tags
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
        return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/\s+/g, ' ')
          .trim();
      }
    }
    // Recurse into nested multipart
    for (const part of payload.parts) {
      if (part.mimeType?.startsWith('multipart/') && part.parts) {
        const result = decodeBody(part);
        if (result) return result;
      }
    }
  }

  return '';
}

async function deepReadEmails(topCandidates, gmail) {
  const deepRead = [];
  const expandedThreads = [];
  let threadExpansions = 0;

  for (const candidate of topCandidates.slice(0, MAX_DEEP_READ)) {
    // Fetch full message body
    const full = await gmail.users.messages.get({
      userId: 'me',
      id: candidate.id,
      format: 'full',
    });

    let body = decodeBody(full.data.payload);
    if (body.length > 2000) body = body.substring(0, 2000) + '...[truncated]';

    const deepEntry = {
      ...candidate,
      body,
      threadExpanded: false,
      threadMessages: null,
    };

    // Decide if thread expansion is warranted
    const isStrategic = candidate.score >= 5;
    if (isStrategic && threadExpansions < MAX_EXPANDED_THREADS) {
      const threadData = await expandThread(candidate.threadId, gmail);
      if (threadData && threadData.length > 1) {
        deepEntry.threadExpanded = true;
        deepEntry.threadMessages = threadData;
        threadExpansions++;
      }
    }

    deepRead.push(deepEntry);
  }

  return { deepRead, expandedThreads: threadExpansions };
}

async function expandThread(threadId, gmail) {
  try {
    const thread = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full',
    });

    const messages = (thread.data.messages || []).slice(0, MAX_MESSAGES_PER_THREAD);
    const result = [];
    let totalChars = 0;

    // Process newest first, then reverse to chronological order
    const reversed = [...messages].reverse();
    const kept = [];

    for (const msg of reversed) {
      const headers = msg.payload.headers;
      const from = headers.find((h) => h.name === 'From')?.value || 'Unknown';
      const date = headers.find((h) => h.name === 'Date')?.value || '';
      let body = decodeBody(msg.payload);

      if (totalChars + body.length > MAX_THREAD_CHARS) {
        const remaining = MAX_THREAD_CHARS - totalChars;
        if (remaining > 100) {
          body = body.substring(0, remaining) + '...[truncated]';
          totalChars = MAX_THREAD_CHARS;
        } else {
          // Skip older messages once budget exhausted
          continue;
        }
      } else {
        totalChars += body.length;
      }

      kept.push({ from, date, body });
    }

    // Reverse back to chronological order (oldest first)
    return kept.reverse();
  } catch {
    return null;
  }
}

// --- Layer 4: Targeted Historical Search ---

async function searchGmail(query) {
  if (!isConfigured()) return [];

  try {
    const auth = await getAuth();
    const gmail = getGmailClient(auth);

    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 10,
    });

    const messages = listResponse.data.messages || [];
    const results = [];

    for (const msg of messages) {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });

      const headers = detail.data.payload.headers;
      results.push({
        id: msg.id,
        from: headers.find((h) => h.name === 'From')?.value || 'Unknown',
        subject: headers.find((h) => h.name === 'Subject')?.value || 'No subject',
        date: headers.find((h) => h.name === 'Date')?.value || '',
        snippet: detail.data.snippet || '',
      });
    }

    return results;
  } catch (err) {
    console.log(`  [Gmail search: ${err.message}]`);
    return [];
  }
}

// --- Layer 5: Summarise for Prompt ---

function summariseEmails(deepRead) {
  if (deepRead.length === 0) return [];

  const summaries = [];

  for (const email of deepRead) {
    const summary = {
      from: email.from,
      subject: email.subject,
      date: email.date,
      isUnread: email.isUnread,
      body: email.body,
      threadExpanded: email.threadExpanded,
      threadMessages: email.threadMessages,
    };
    summaries.push(summary);
  }

  return summaries;
}

function formatEmailsForPrompt(emailData) {
  if (!emailData) return '';

  const { triageCount, deepReadCount, expandedThreadCount, unreadCount, summaries } = emailData;

  if (!summaries || summaries.length === 0) {
    return `Scanned: ${triageCount || 0} emails (last ${TRIAGE_WINDOW_HOURS}h). No goal-relevant emails found.`;
  }

  let output = `Scanned: ${triageCount} emails (last ${TRIAGE_WINDOW_HOURS}h) | Deeply read: ${deepReadCount} | Threads expanded: ${expandedThreadCount} | Inbox unread: ${unreadCount}\n\n`;

  // Compressed thread-level summaries only — no raw bodies in prompt
  for (let i = 0; i < summaries.length; i++) {
    const s = summaries[i];
    const status = s.isUnread ? 'UNREAD — needs reply' : 'read';
    const fromShort = s.from.replace(/<[^>]+>/g, '').trim();

    output += `${i + 1}. ${fromShort} — ${s.subject}\n`;
    output += `   Status: ${status}. Date: ${s.date}\n`;

    if (s.threadExpanded && s.threadMessages) {
      output += `   Thread: ${s.threadMessages.length} messages. `;
      const lastMsg = s.threadMessages[s.threadMessages.length - 1];
      if (lastMsg) {
        const lastFrom = lastMsg.from.replace(/<[^>]+>/g, '').trim();
        output += `Latest from ${lastFrom}.\n`;
      }
    }

    // Use AI-generated summary if available, otherwise snippet
    if (s.aiSummary) {
      output += `   ${s.aiSummary}\n`;
    } else if (s.body) {
      // Compress to one-line snippet
      const snippet = s.body.replace(/\s+/g, ' ').substring(0, 150).trim();
      output += `   Preview: ${snippet}\n`;
    }
    output += '\n';
  }

  return output;
}

// --- Layer 6: Full Pipeline ---

async function fetchEmailContext(goals, openActions, recentEntries) {
  if (!isConfigured()) return null;

  try {
    console.log(`  [Gmail: scanning last ${TRIAGE_WINDOW_HOURS}h...]`);

    // Layer 1: Cheap triage
    const triageResult = await fetchTriageCandidates();
    if (!triageResult || triageResult.candidates.length === 0) {
      console.log('  [Gmail: no emails found]');
      return null;
    }

    const { candidates, unreadCount, gmail } = triageResult;
    console.log(`  [Gmail: ${candidates.length} candidates, ${unreadCount} unread]`);

    // Layer 2: Goal-aware ranking
    const ranked = rankEmails(candidates, goals, openActions, recentEntries);
    const topCandidates = ranked.filter((c) => c.score > 0);
    console.log(`  [Gmail: ${topCandidates.length} goal-relevant]`);

    // Layer 3: Selective deep read
    const { deepRead, expandedThreads } = await deepReadEmails(topCandidates, gmail);
    console.log(`  [Gmail: ${deepRead.length} deeply read, ${expandedThreads} threads expanded]`);

    // Layer 5: Summarise
    const summaries = summariseEmails(deepRead);

    const emailContext = {
      triageCount: candidates.length,
      deepReadCount: deepRead.length,
      expandedThreadCount: expandedThreads,
      unreadCount,
      summaries,
      // Keep all candidates for /emails command display
      allCandidates: candidates,
    };

    cachedEmailContext = emailContext;
    return emailContext;
  } catch (err) {
    console.log(`  [Gmail: ${err.message}]`);
    return null;
  }
}

function getCachedEmailContext() {
  return cachedEmailContext;
}

module.exports = {
  isConfigured,
  fetchEmailContext,
  getCachedEmailContext,
  searchGmail,
  formatEmailsForPrompt,
};
