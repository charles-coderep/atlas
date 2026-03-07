const readline = require('readline');
const { initDB, getActiveGoals } = require('./db');
const { runInterview } = require('./interview');
const { generateBrief } = require('./brief');
const { runSession } = require('./session');

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function main() {
  initDB();

  const args = process.argv.slice(2);

  if (args.includes('--interview')) {
    await runInterview();
    return;
  }

  if (args.includes('--brief')) {
    await generateBrief();
    return;
  }

  console.log('\n  ============================================');
  console.log('  ATLAS — Strategic Adviser');
  console.log('  ============================================\n');

  const goals = await getActiveGoals();

  if (goals.length === 0) {
    console.log("  No goals defined yet. Let's start with a goal-definition interview.\n");
    await runInterview();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const next = await ask(rl, '\n  Goal recorded. Start an advisory session? (yes/no) ');
    rl.close();

    if (next.toLowerCase().startsWith('y')) {
      await runSession();
    }
    return;
  }

  console.log(`  ${goals.length} active goal(s):`);
  for (const g of goals) {
    console.log(`    [${g.priority || '-'}] ${g.title}`);
  }
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('  What would you like to do?');
  console.log('    1. Morning brief');
  console.log('    2. Advisory session');
  console.log('    3. Define a new goal');
  console.log('    4. Exit\n');

  const choice = await ask(rl, '  Choose (1-4): ');
  rl.close();

  switch (choice) {
    case '1':
      await generateBrief();
      break;
    case '2':
      await runSession();
      break;
    case '3':
      await runInterview();
      break;
    case '4':
      console.log('\n  Exiting Atlas.\n');
      break;
    default:
      console.log('\n  Starting advisory session by default.\n');
      await runSession();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
