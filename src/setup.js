const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CREDENTIALS_PATH = path.join(__dirname, '..', 'config', 'credentials', 'google_credentials.json');
const TOKEN_PATH = path.join(__dirname, '..', 'config', 'credentials', 'google_token.json');
const PREFS_PATH = path.join(__dirname, '..', 'config', 'credentials', '.setup_prefs.json');

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function loadPrefs() {
  try {
    return JSON.parse(fs.readFileSync(PREFS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function savePrefs(prefs) {
  const dir = path.dirname(PREFS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2));
}

function isGoogleConfigured() {
  return fs.existsSync(CREDENTIALS_PATH) && fs.existsSync(TOKEN_PATH);
}

async function runGoogleOAuth() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.log('\n  To connect Google services:');
    console.log('    1. Go to console.cloud.google.com');
    console.log('    2. Create a project, enable Calendar API and Gmail API');
    console.log('    3. Create OAuth2 credentials (Desktop application)');
    console.log(`    4. Download the JSON and save it to:\n       ${CREDENTIALS_PATH}`);
    console.log('    5. Run Atlas again\n');
    return false;
  }

  try {
    const { google } = require('googleapis');
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;
    const auth = new google.auth.OAuth2(client_id, client_secret, 'urn:ietf:wg:oauth:2.0:oob');

    const authUrl = auth.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/gmail.readonly',
      ],
    });

    console.log('\n  Open this URL in your browser:\n');
    console.log(`  ${authUrl}\n`);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const code = await ask(rl, '  Paste the authorization code here: ');
    rl.close();

    const { tokens } = await auth.getToken(code);
    const dir = path.dirname(TOKEN_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));

    console.log('\n  Google services connected successfully.\n');
    return true;
  } catch (err) {
    console.error(`\n  OAuth setup failed: ${err.message}\n`);
    return false;
  }
}

async function checkAndPromptSetup() {
  if (isGoogleConfigured()) return;

  const prefs = loadPrefs();
  if (prefs.google_declined) return;

  try {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    // Prevent readline close from ending the process
    rl.on('close', () => {});

    const answer = await ask(rl,
      '\n  Would you like to connect Google Calendar and Gmail?\n' +
      '  This enables calendar-aware scheduling and email highlights in your briefs.\n' +
      '  You can set this up later anytime. (yes/no) '
    );
    rl.close();

    if (answer.toLowerCase().startsWith('y')) {
      await runGoogleOAuth();
    } else {
      savePrefs({ ...prefs, google_declined: true });
      console.log('  Skipped. You can set this up later.\n');
    }
  } catch (err) {
    // If readline fails, skip setup silently
    console.log('  [Skipping Google setup prompt]\n');
  }
}

module.exports = { checkAndPromptSetup, isGoogleConfigured, runGoogleOAuth };
