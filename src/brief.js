const { getActiveGoals } = require('./db');
const { buildSystemPrompt, callClaude } = require('./orchestrator');

async function generateBrief() {
  const goals = await getActiveGoals();

  if (goals.length === 0) {
    console.log('\n  No active goals found. Run the goal-definition interview first.\n');
    return null;
  }

  const systemPrompt = buildSystemPrompt(goals);
  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const briefPrompt = `Generate today's morning brief. Today is ${today}.

You have ${goals.length} active goal(s). Review them all and produce a strategic brief with:

1. **Top 3 Priorities Today** — The most important things to focus on, derived from active goals. Be specific and tactical, not generic.
2. **Open Questions or Decisions Pending** — Anything that needs the user's attention or a decision.
3. **Risks or Concerns** — Anything that could derail progress, including patterns you've noticed.
4. **Recommended Focus for the Day** — A clear directive on where to spend time and energy today.

Keep it scannable — under 3 minutes to read. No fluff. Lead with what matters.`;

  console.log('\n  ============================================');
  console.log('  ATLAS — Morning Brief');
  console.log(`  ${today}`);
  console.log('  ============================================\n');

  try {
    const brief = await callClaude(briefPrompt, systemPrompt);
    console.log(`  ${brief.split('\n').join('\n  ')}\n`);
    return brief;
  } catch (err) {
    console.error('  Error generating brief:', err.message);
    return null;
  }
}

module.exports = { generateBrief };
