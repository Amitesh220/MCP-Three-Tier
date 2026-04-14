const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Classify a single test failure by severity and type using LLM.
 * 
 * @param {Object} issue - Failure object with { test, error, logs, type }
 * @returns {{ severity: string, type: string, reason: string, originalIssue: Object }}
 */
async function classifyIssue(issue) {
  const context = typeof issue === 'string'
    ? issue
    : `Test: ${issue.test}\nError: ${issue.error}\nType hint: ${issue.type}\nLogs: ${issue.logs || 'N/A'}`;

  const prompt = `
Analyze the following test failure and classify it.

Severity Levels:
- CRITICAL: App crash, API down, broken routes, server errors, connection failures.
- HIGH: Business logic broken (wrong data, validation bugs), OR explicit UI test failures containing words like "Timeout", "locator", "click", or "element not found".
- MEDIUM: Minor UI functional issues (state not updating, visual defects not causing timeout).
- LOW: Styling, alignment, or minor cosmetic UI issues.

Type Categories:
- API: Backend/network/server/request related failures.
- UI: Frontend rendering, element visibility, interaction failures.
- LOGIC: Business logic, data processing, validation errors.

Failure context:
${context}

Return ONLY a valid JSON object in this format:
{
  "severity": "CRITICAL",
  "type": "API",
  "reason": "short explanation"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a strict technical triage AI. Return only valid JSON.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content.trim());

    // Validate severity
    const validSeverities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
    if (!validSeverities.includes(result.severity)) {
      result.severity = 'MEDIUM';
    }

    // Validate type
    const validTypes = ['UI', 'API', 'LOGIC'];
    if (!validTypes.includes(result.type)) {
      result.type = issue.type || 'LOGIC';
    }

    return { ...result, originalIssue: issue };
  } catch (err) {
    console.error('[Triage] Failed to classify issue:', err.message);
    return {
      severity: 'MEDIUM',
      type: (typeof issue === 'object' && issue.type) || 'LOGIC',
      reason: 'Fallback due to classification error',
      originalIssue: issue
    };
  }
}

/**
 * Sort classified issues by severity: CRITICAL > HIGH > MEDIUM > LOW
 */
function sortIssues(classifiedIssues) {
  const severityValue = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

  return classifiedIssues.sort((a, b) => {
    return (severityValue[b.severity] || 0) - (severityValue[a.severity] || 0);
  });
}

/**
 * Filter out LOW priority issues. Keep CRITICAL, HIGH, and MEDIUM.
 */
function filterTopPriority(sortedIssues) {
  return sortedIssues.filter(i => i.severity !== 'LOW');
}

/**
 * Full triage pipeline: classify all → sort → filter top priority.
 * 
 * @param {Array} failuresList - Array of failure objects from MCP /run-tests
 * @returns {Array} Prioritized issues (CRITICAL, HIGH, MEDIUM)
 */
async function triageIssues(failuresList) {
  console.log(`\n[Triage] ========================================`);
  console.log(`[Triage] Starting triage for ${failuresList.length} issue(s)...`);

  const classified = await Promise.all(failuresList.map(classifyIssue));

  const stats = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  classified.forEach(i => {
    stats[i.severity] = (stats[i.severity] || 0) + 1;
    console.log(`[Triage]   → ${i.severity} | ${i.type} | ${i.reason}`);
  });

  console.log(`[Triage] Breakdown: CRITICAL=${stats.CRITICAL}, HIGH=${stats.HIGH}, MEDIUM=${stats.MEDIUM}, LOW=${stats.LOW}`);

  const sorted = sortIssues(classified);
  const prioritized = filterTopPriority(sorted);

  console.log(`[Triage] Forwarding ${prioritized.length} issue(s) to fixing agent (CRITICAL, HIGH, MEDIUM). Skipping ${classified.length - prioritized.length} LOW priority issues.`);
  console.log(`[Triage] ========================================\n`);

  return prioritized;
}

module.exports = { classifyIssue, sortIssues, filterTopPriority, triageIssues };
