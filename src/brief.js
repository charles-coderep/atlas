const { getActiveGoals, getOpenActions, getOverdueActions, getFiles } = require('./db');
const { buildSystemPrompt, callEngine } = require('./orchestrator');

async function generateBrief(options = {}) {
  const goals = await getActiveGoals();

  if (goals.length === 0) {
    console.log('\n  No active goals found. Run the goal-definition interview first.\n');
    return null;
  }

  const systemPrompt = await buildSystemPrompt(goals, {
    calendarData: options.calendarData || null,
    emailData: options.emailData || null,
  });

  const openActions = await getOpenActions();
  const overdueActions = await getOverdueActions();
  const files = await getFiles();

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Build context sources list
  const contextSources = [
    `${goals.length} active goal(s)`,
    `${openActions.length} open action items (${overdueActions.length} overdue)`,
    'Session history from the last 7 days',
    'Persistent insights and patterns',
  ];
  if (options.calendarData) contextSources.push('Today\'s calendar events');
  if (options.emailData) contextSources.push('Recent unread emails (last 24h)');
  if (files.length > 0) contextSources.push(`${files.length} ingested file(s)`);

  // Build sections dynamically — order matters, numbering is automatic
  const sections = [
    '**Top 3 Priorities Today** — derived from active goals AND open action items. Reference specific actions by name.',
    '**Open Commitments** — status of action items, especially overdue ones. Be specific: "You committed to X on [date], it\'s now overdue."',
    '**Risks or Concerns** — patterns from recent sessions, overdue items, goal drift.',
  ];
  if (options.calendarData) {
    sections.push('**Schedule Awareness** — note today\'s events and any conflicts with priorities.');
  }
  if (options.emailData) {
    sections.push('**Email Highlights** — flag any emails that relate to active goals or require action.');
  }
  sections.push('**Recommended Focus** — clear directive on where to spend time and energy today.');

  const numberedSections = sections.map((s, i) => `${i + 1}. ${s}`).join('\n');

  const briefPrompt = `Generate today's morning brief. Today is ${today}.

You have access to:
${contextSources.map((s) => `- ${s}`).join('\n')}

Produce a strategic brief:

${numberedSections}

Keep it scannable. Under 3 minutes to read. Reference specific past events and commitments, not generic advice.`;

  console.log('\n  ============================================');
  console.log('  ATLAS — Morning Brief');
  console.log(`  ${today}`);
  console.log('  ============================================\n');

  try {
    const brief = await callEngine(briefPrompt, systemPrompt);
    console.log(`  ${brief.split('\n').join('\n  ')}\n`);
    return brief;
  } catch (err) {
    console.error('  Error generating brief:', err.message);
    return null;
  }
}

module.exports = { generateBrief };
