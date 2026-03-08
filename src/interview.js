const crypto = require('crypto');
const readline = require('readline');
const { saveGoal } = require('./db');
const { callClaude, mapDirectnessToTone, setSelectedTone } = require('./orchestrator');

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

const VALID_PRIORITIES = ['primary', 'secondary', 'supporting'];

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(`\n  Atlas: ${question}\n  You: `, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function askPriority(rl) {
  while (true) {
    const input = await ask(rl, 'What priority level should this goal have? (primary / secondary / supporting)');
    if (VALID_PRIORITIES.includes(input.toLowerCase())) {
      return input.toLowerCase();
    }
    console.log('  Please choose: primary, secondary, or supporting.');
  }
}

function buildAnswersSummary(answers, optionalAnswers) {
  let summary = `1. What they want to achieve: ${answers.q1}
2. Why it matters now: ${answers.q2}
3. Success criteria: ${answers.q3}
4. Target timeframe: ${answers.q4}
5. Current baseline: ${answers.q5}
6. Constraints: ${answers.q6}
7. Derailment patterns: ${answers.q7}
8. Support wanted: ${answers.q8}
9. Directness level: ${answers.q9}`;

  if (Object.keys(optionalAnswers).length > 0) {
    summary += '\n\nAdditional answers:\n' +
      Object.entries(optionalAnswers).map(([q, a]) => `- ${q}: ${a}`).join('\n');
  }

  return summary;
}

async function evaluateGoalSharpness(answers, optionalAnswers) {
  const summary = buildAnswersSummary(answers, optionalAnswers);

  const evalPrompt = `Evaluate these goal-definition interview answers. Is the goal specific enough to act on?

${summary}

Check each of these:
- Is the success criteria measurable and specific (not vague like "be comfortable" or "enough money")?
- Is the timeframe concrete (an actual date or specific period, not "soon" or "I don't know")?
- Are the constraints specific enough to respect?
- Is the core goal clear enough to build a strategy around?

If ANY of these are too vague, respond with ONLY a JSON object:
{"sharp": false, "follow_ups": ["specific follow-up question 1", "specific follow-up question 2"]}

The follow-up questions should be targeted and specific, pushing for measurable criteria and concrete dates. Be direct — this is a strategic adviser, not a therapist.

If the goal is sharp enough to act on, respond with ONLY:
{"sharp": true}`;

  const result = await callClaude(evalPrompt, 'You evaluate goal specificity. Output only valid JSON, nothing else.');
  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { sharp: true };

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return { sharp: true };
  }
}

async function runInterview() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const goalId = `goal_${crypto.randomUUID().split('-')[0]}`;

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

  // Quality gate — evaluate sharpness, refine up to 2 times
  for (let attempt = 0; attempt < 2; attempt++) {
    console.log('\n  Evaluating goal clarity...\n');

    try {
      const evaluation = await evaluateGoalSharpness(answers, optionalAnswers);

      if (evaluation.sharp) {
        break;
      }

      if (evaluation.follow_ups && evaluation.follow_ups.length > 0) {
        console.log("  I need a bit more precision to make this goal actionable.\n");
        for (const followUp of evaluation.follow_ups) {
          const answer = await ask(rl, followUp);
          if (answer) {
            // Merge follow-up answers into the relevant fields based on content
            optionalAnswers[followUp] = answer;
          }
        }
      }
    } catch {
      // If evaluation fails, proceed with what we have
      break;
    }
  }

  const priority = await askPriority(rl);

  console.log('\n  Processing your answers into a structured goal record...\n');

  const summary = buildAnswersSummary(answers, optionalAnswers);

  const structurePrompt = `You are structuring a goal-definition interview into a JSON goal record.

Here are the raw interview answers:

${summary}

Priority: ${priority}

Produce ONLY a valid JSON object (no markdown, no explanation) with this exact structure:
{
  "title": "concise goal title",
  "type": "one of: career, financial, learning, health, business, personal",
  "priority": "${priority}",
  "why_now": "why this matters now",
  "success_criteria": "specific measurable criteria",
  "target_date": "YYYY-MM-DD or null if genuinely unknown",
  "baseline": "where they're starting from",
  "constraints": ["array", "of", "constraints"],
  "derailment_patterns": ["array", "of", "patterns"],
  "atlas_directness": "one of: low, medium, high",
  "anti_goals": ["things that must not happen"],
  "tradeoff_tolerance": "what tradeoffs are acceptable",
  "past_failures": ["what didn't work before"],
  "support_type": "what kind of support they want",
  "status": "active",
  "created_at": "${new Date().toISOString().split('T')[0]}"
}

Rules:
- atlas_directness MUST be exactly one of: "low", "medium", "high". Map the user's language accordingly.
- target_date MUST be a valid YYYY-MM-DD date or null. Do not use placeholders.
- type MUST be one of: career, financial, learning, health, business, personal.
- If any field has no data, use an empty array [] for arrays or null for strings.
- The title must be sharp and specific — not vague.`;

  try {
    const result = await callClaude(structurePrompt, 'You are a data structuring assistant. Output only valid JSON, nothing else.');

    let jsonStr = result;
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const goalRecord = JSON.parse(jsonStr);

    // Override ID with our generated one
    goalRecord.id = goalId;

    // Validate target_date
    if (goalRecord.target_date && !/^\d{4}-\d{2}-\d{2}$/.test(goalRecord.target_date)) {
      goalRecord.target_date = null;
    }

    // Validate atlas_directness
    if (!['low', 'medium', 'high'].includes(goalRecord.atlas_directness)) {
      goalRecord.atlas_directness = 'high';
    }

    setSelectedTone(mapDirectnessToTone(goalRecord.atlas_directness));

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
    console.log(`  Target: ${goalRecord.target_date || 'To be defined'}`);
    console.log('  ============================================\n');

    rl.close();
    return goalRecord;
  } catch (err) {
    console.error('  Error structuring goal:', err.message);
    console.log('  Saving raw answers as fallback...\n');

    const fallbackGoal = {
      id: goalId,
      title: answers.q1.substring(0, 80),
      type: null,
      priority: priority,
      why_now: answers.q2,
      success_criteria: answers.q3,
      target_date: null,
      baseline: answers.q5,
      constraints: [answers.q6],
      derailment_patterns: [answers.q7],
      atlas_directness: 'high',
      status: 'active',
      created_at: new Date().toISOString().split('T')[0],
    };

    setSelectedTone(mapDirectnessToTone(fallbackGoal.atlas_directness));

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
