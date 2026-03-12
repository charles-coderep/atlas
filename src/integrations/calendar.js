const fs = require('fs');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, '..', '..', 'config', 'credentials', 'google_credentials.json');
const TOKEN_PATH = path.join(__dirname, '..', '..', 'config', 'credentials', 'google_token.json');

const CACHE_TTL_MS = 120_000; // 2 minutes
let cachedEvents = null;
let cachedEventsTimestamp = 0;

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

  // Refresh if expired
  if (token.expiry_date && token.expiry_date < Date.now()) {
    const { credentials: newCreds } = await auth.refreshAccessToken();
    auth.setCredentials(newCreds);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(newCreds), 'utf-8');
  }

  return auth;
}

async function fetchCalendarEvents() {
  if (!isConfigured()) return null;

  // Return cached result if within TTL
  if (cachedEvents && (Date.now() - cachedEventsTimestamp) < CACHE_TTL_MS) {
    console.log('  [Calendar: returning cached result]');
    return cachedEvents;
  }

  try {
    const { google } = require('googleapis');
    const auth = await getAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    const now = new Date();
    const weekFromNow = new Date();
    weekFromNow.setDate(weekFromNow.getDate() + 7);

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: weekFromNow.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
    });

    const events = (response.data.items || []).map((e) => ({
      title: e.summary || 'Untitled',
      start: e.start.dateTime || e.start.date,
      end: e.end.dateTime || e.end.date,
      location: e.location || null,
      allDay: !e.start.dateTime,
    }));

    const todayStr = now.toISOString().split('T')[0];
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    cachedEvents = {
      today: events.filter((e) => e.start.startsWith(todayStr)),
      thisWeek: events,
      imminent: events.filter((e) => {
        const start = new Date(e.start);
        return start >= now && start <= twoHoursFromNow;
      }),
    };
    cachedEventsTimestamp = Date.now();

    return cachedEvents;
  } catch (err) {
    console.log(`  [Calendar: ${err.message}]`);
    return null;
  }
}

function getCachedEvents() {
  return cachedEvents;
}

function formatCalendarForPrompt(events) {
  if (!events) return '';

  let output = '';

  if (events.imminent.length > 0) {
    output += '⚠️ IMMINENT:\n';
    for (const e of events.imminent) {
      const time = new Date(e.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      output += `- ${time} ${e.title}${e.location ? ` @ ${e.location}` : ''}\n`;
    }
    output += '\n';
  }

  if (events.today.length > 0) {
    output += 'Today:\n';
    for (const e of events.today) {
      if (e.allDay) {
        output += `- All day: ${e.title}\n`;
      } else {
        const time = new Date(e.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        output += `- ${time} ${e.title}${e.location ? ` @ ${e.location}` : ''}\n`;
      }
    }
  } else {
    output += 'Today: No events scheduled.\n';
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const upcoming = events.thisWeek.filter((e) => !e.start.startsWith(todayStr));
  if (upcoming.length > 0) {
    output += '\nThis week:\n';
    for (const e of upcoming.slice(0, 10)) {
      const date = new Date(e.start).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      const time = e.allDay ? 'All day' : new Date(e.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      output += `- ${date} ${time} ${e.title}\n`;
    }
  }

  return output;
}

module.exports = { isConfigured, fetchCalendarEvents, getCachedEvents, formatCalendarForPrompt };
