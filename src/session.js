const readline = require('readline');
const { getActiveGoals } = require('./db');
const { buildSystemPrompt, callClaudeConversation } = require('./orchestrator');

async function runSession() {
  const goals = await getActiveGoals();

  if (goals.length === 0) {
    console.log('\n  No active goals found. Run the goal-definition interview first.\n');
    return;
  }

  const systemPrompt = buildSystemPrompt(goals);
  const conversationHistory = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('\n  ============================================');
  console.log('  ATLAS — Advisory Session');
  console.log('  ============================================');
  console.log('  Type your message. Commands: /brief, /goals, /quit\n');

  const prompt = () => {
    rl.question('  You: ', async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed === '/quit' || trimmed === '/exit') {
        console.log('\n  Atlas: Session ended. Stay sharp.\n');
        rl.close();
        return;
      }

      if (trimmed === '/brief') {
        const { generateBrief } = require('./brief');
        await generateBrief();
        prompt();
        return;
      }

      if (trimmed === '/goals') {
        const currentGoals = await getActiveGoals();
        console.log('\n  Active Goals:');
        for (const g of currentGoals) {
          console.log(`    [${g.priority || '-'}] ${g.title} (${g.id})`);
        }
        console.log('');
        prompt();
        return;
      }

      conversationHistory.push({ role: 'User', content: trimmed });

      try {
        process.stdout.write('\n  Atlas: ');
        const response = await callClaudeConversation(trimmed, systemPrompt, conversationHistory.slice(0, -1));
        console.log(`${response.split('\n').join('\n  ')}\n`);
        conversationHistory.push({ role: 'Atlas', content: response });
      } catch (err) {
        console.error(`\n  [Error: ${err.message}]\n`);
      }

      prompt();
    });
  };

  prompt();

  return new Promise((resolve) => {
    rl.on('close', resolve);
  });
}

module.exports = { runSession };
