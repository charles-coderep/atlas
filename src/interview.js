const readline = require('readline');
const { saveGoal, getActiveGoals } = require('./db');
const { callClaude } = require('./orchestrator');

const REQUIRED_QUESTIONS = [
  'What do you want to achieve?',
  'Why does this matter right now?',
  'What would success actually look like? Be specific and measurable.',
  "What's your target timeframe?",
  "What's your current baseline? Where are you starting from?",
  'What constraints must I respect? (money, time, location, health, ethics)',
  'What usually derails you here?',
  'What kind of support do you want from me?',
  "How direct should I be when I think you're drifting?",
];

const OPTIONAL_QUESTIONS = [
  'What must NOT happen? Any anti-goals?',
  'What tradeoffs are you willing to accept?',
  "What have you tried before that didn't work?",
];

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(`\n  Atlas: ${question}\n  You: `, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function runInterview() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const existingGoals = await getActiveGoals();
  const goalNumber = existingGoals.length + 1;

  console.log('\n  ============================================');
  console.log('  ATLAS — Goal Definition Interview');
  console.log('  ============================================\n');
  console.log("  Let's define a new goal. I'll ask you a series of questions");
  console.log('  to turn your ambition into something I can work with.\n');

  const answers = {};

  for (let i = 0; i < REQUIRED_QUESTIONS.length; i++) {
    const answer = await ask(rl, REQUIRED_QUESTIONS[i]);
    answers[`q${i + 1}`] = answer;
  }

  const optionalAnswers = {};
  const askOptional = await ask(rl, 'A few more questions that might be relevant. Want to go deeper? (yes/no)');

  if (askOptional.toLowerCase().startsWith('y')) {
    for (const q of OPTIONAL_QUESTIONS) {
      const answer = await ask(rl, q);
      if (answer) {
        optionalAnswers[q] = answer;
      }
    }
  }

  const priority = await ask(rl, 'What priority level should this goal have? (primary / secondary / supporting)');

  console.log('\n  Processing your answers into a structured goal record...\n');

  const structurePrompt = `You are structuring a goal-definition interview into a JSON goal record.

Here are the raw interview answers:

1. What they want to achieve: ${answers.q1}
2. Why it matters now: ${answers.q2}
3. Success criteria: ${answers.q3}
4. Target timeframe: ${answers.q4}
5. Current baseline: ${answers.q5}
6. Constraints: ${answers.q6}
7. Derailment patterns: ${answers.q7}
8. Support wanted: ${answers.q8}
9. Directness level: ${answers.q9}

${Object.keys(optionalAnswers).length > 0 ? 'Additional answers:\n' + Object.entries(optionalAnswers).map(([q, a]) => `- ${q}: ${a}`).join('\n') : ''}

Priority: ${priority || 'primary'}

Produce ONLY a valid JSON object (no markdown, no explanation) with this exact structure:
{
  "id": "goal_${String(goalNumber).padStart(3, '0')}",
  "title": "concise goal title",
  "type": "category (career, financial, learning, health, business, personal)",
  "priority": "${priority || 'primary'}",
  "why_now": "why this matters now",
  "success_criteria": "specific measurable criteria",
  "target_date": "YYYY-MM-DD",
  "baseline": "where they're starting from",
  "constraints": ["array", "of", "constraints"],
  "derailment_patterns": ["array", "of", "patterns"],
  "atlas_directness": "low/medium/high",
  "anti_goals": ["things that must not happen"],
  "tradeoff_tolerance": "what tradeoffs are acceptable",
  "past_failures": ["what didn't work before"],
  "support_type": "what kind of support they want",
  "status": "active",
  "created_at": "${new Date().toISOString().split('T')[0]}"
}

If any field has no data, use an empty array [] for arrays or null for strings. Ensure the goal title is sharp and specific — not vague.`;

  try {
    const result = await callClaude(structurePrompt, 'You are a data structuring assistant. Output only valid JSON, nothing else.');

    let jsonStr = result;
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const goalRecord = JSON.parse(jsonStr);

    await saveGoal({
      id: goalRecord.id,
      title: goalRecord.title,
      type: goalRecord.type,
      priority: goalRecord.priority,
      goal_data: goalRecord,
      status: 'active',
    });

    console.log('  ============================================');
    console.log(`  Goal recorded: ${goalRecord.title}`);
    console.log(`  ID: ${goalRecord.id}`);
    console.log(`  Priority: ${goalRecord.priority}`);
    console.log(`  Target: ${goalRecord.target_date}`);
    console.log('  ============================================\n');

    rl.close();
    return goalRecord;
  } catch (err) {
    console.error('  Error structuring goal:', err.message);
    console.log('  Saving raw answers as fallback...\n');

    const fallbackGoal = {
      id: `goal_${String(goalNumber).padStart(3, '0')}`,
      title: answers.q1.substring(0, 80),
      type: null,
      priority: priority || 'primary',
      why_now: answers.q2,
      success_criteria: answers.q3,
      target_date: null,
      baseline: answers.q5,
      constraints: [answers.q6],
      derailment_patterns: [answers.q7],
      atlas_directness: answers.q9,
      status: 'active',
      created_at: new Date().toISOString().split('T')[0],
    };

    await saveGoal({
      id: fallbackGoal.id,
      title: fallbackGoal.title,
      type: fallbackGoal.type,
      priority: fallbackGoal.priority,
      goal_data: fallbackGoal,
      status: 'active',
    });

    console.log(`  Goal saved (raw): ${fallbackGoal.title}\n`);
    rl.close();
    return fallbackGoal;
  }
}

module.exports = { runInterview };
