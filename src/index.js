const readline = require('readline');
const { initDB, getActiveGoals, getOpenActions, getRecentEntries } = require('./db');
const { checkUserContextFiles } = require('./orchestrator');
const { runInterview } = require('./interview');
const { generateBrief } = require('./brief');
const { runSession } = require('./session');
const { checkAndPromptSetup, isGoogleConfigured } = require('./setup');

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function fetchExternalData() {
  const data = { calendarData: null, emailData: null };

  if (!isGoogleConfigured()) return data;

  console.log('  [Fetching external data...]');

  try {
    const { fetchCalendarEvents } = require('./integrations/calendar');
    data.calendarData = await fetchCalendarEvents();
    if (data.calendarData) {
      const eventCount = (data.calendarData.today || []).length;
      console.log(`  [Calendar: ${eventCount} event(s) today]`);
    }
  } catch (err) {
    console.log(`  [Calendar: ${err.message}]`);
  }

  try {
    const { fetchEmailContext } = require('./integrations/gmail');
    // Email pipeline needs goals, actions, and entries for ranking
    const goals = await getActiveGoals();
    const openActions = await getOpenActions();
    const recentEntries = await getRecentEntries(7);
    data.emailData = await fetchEmailContext(goals, openActions, recentEntries);
  } catch (err) {
    console.log(`  [Gmail: ${err.message}]`);
  }

  return data;
}

async function main() {
  await initDB();

  // Startup: check for placeholder user context files
  const warnings = checkUserContextFiles();
  if (warnings.length > 0) {
    console.log('\n  ⚠ Some user context files still have placeholder content:');
    for (const w of warnings) {
      console.log(`    - ${w}`);
    }
    console.log('  Fill these in for better, personalised advice.\n');
  }

  // Startup: prompt for Google setup if not configured
  await checkAndPromptSetup();

  const args = process.argv.slice(2);

  if (args.includes('--interview')) {
    await runInterview();
    return;
  }

  // Fetch external data once at startup
  const externalData = await fetchExternalData();

  if (args.includes('--brief')) {
    await generateBrief(externalData);
    return;
  }

  console.log('\n  ============================================');
  console.log('  ATLAS — Strategic Adviser');
  console.log('  ============================================');

  while (true) {
    const goals = await getActiveGoals();

    if (goals.length === 0) {
      console.log("\n  No goals defined yet. Let's start with a goal-definition interview.\n");
      await runInterview();
      continue;
    }

    console.log(`\n  ${goals.length} active goal(s):`);
    for (const g of goals) {
      console.log(`    [${g.priority || '-'}] ${g.title}`);
    }

    console.log('\n  What would you like to do?');
    console.log('    1. Morning brief');
    console.log('    2. Advisory session');
    console.log('    3. Define a new goal');
    console.log('    4. Exit\n');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const choice = await ask(rl, '  Choose (1-4): ');
    rl.close();

    switch (choice) {
      case '1':
        await generateBrief(externalData);
        break;
      case '2':
        await runSession(externalData);
        break;
      case '3':
        await runInterview();
        break;
      case '4':
        console.log('\n  Exiting Atlas.\n');
        process.exit(0);
      default:
        console.log('  Invalid choice.');
        break;
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
