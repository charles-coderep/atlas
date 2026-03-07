const { callClaude } = require('./orchestrator');

async function webSearch(query, systemPrompt) {
  const prompt = `The user needs current, real-time information. Search the web and provide accurate, sourced results.

Query: ${query}

Provide the results with sources. Be specific — include dates, numbers, and URLs where relevant.`;

  try {
    return await callClaude(prompt, systemPrompt || 'You are a web research assistant. Search the web and provide accurate, sourced results.', {
      allowedTools: ['mcp__claude-web-search__web_search'],
    });
  } catch (err) {
    return `Web search failed: ${err.message}`;
  }
}

// Process Atlas response for [SEARCH: ...] markers and execute them
async function processSearchMarkers(response, systemPrompt) {
  const searchPattern = /\[SEARCH:\s*(.+?)\]/g;
  const matches = [...response.matchAll(searchPattern)];

  if (matches.length === 0) return { response, searchResults: null };

  const results = [];
  for (const match of matches) {
    const query = match[1].trim();
    console.log(`  [Searching: ${query}]`);
    const result = await webSearch(query, systemPrompt);
    results.push({ query, result });
  }

  return { response, searchResults: results };
}

module.exports = { webSearch, processSearchMarkers };
