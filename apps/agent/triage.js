const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function classifyIssue(issue) {
  const prompt = `
Analyze the following test failure and classify its severity.
Severity Levels:
- CRITICAL: App crash, API failure, broken routes, or severe core logic fails.
- HIGH: Business logic issues (wrong data, validation bugs).
- MEDIUM: UI functional issues (buttons not working, state not updating).
- LOW: Styling, alignment, or minor UI issues.

Failure context:
${issue}

Return ONLY a valid JSON object in this format:
{
  "severity": "CRITICAL",
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
    return { ...result, originalIssue: issue };
  } catch (err) {
    console.error('Failed to classify issue:', err.message);
    return { severity: 'MEDIUM', reason: 'Fallback due to classification error', originalIssue: issue };
  }
}

function sortIssues(classifiedIssues) {
  const severityValue = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  
  return classifiedIssues.sort((a, b) => {
    return (severityValue[b.severity] || 0) - (severityValue[a.severity] || 0);
  });
}

function filterTopPriority(sortedIssues) {
  const criticals = sortedIssues.filter(i => i.severity === 'CRITICAL');
  const highs = sortedIssues.filter(i => i.severity === 'HIGH').slice(0, 2);
  
  return [...criticals, ...highs];
}

async function triageIssues(failuresList) {
  console.log(`[Triage] Starting triage for ${failuresList.length} issues...`);
  
  const classified = await Promise.all(failuresList.map(classifyIssue));
  
  const stats = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  classified.forEach(i => {
    stats[i.severity] = (stats[i.severity] || 0) + 1;
    console.log(`[Triage] Classified issue as ${i.severity}: ${i.reason}`);
  });
  
  console.log(`[Triage] Breakdown: CRITICAL=${stats.CRITICAL}, HIGH=${stats.HIGH}, MEDIUM=${stats.MEDIUM}, LOW=${stats.LOW}`);
  
  const sorted = sortIssues(classified);
  const prioritized = filterTopPriority(sorted);
  
  console.log(`[Triage] Forwarding ${prioritized.length} issues to fixing agent (ALL CRITICAL and max 2 HIGH). Skipping remaining...`);
  
  return prioritized;
}

module.exports = { classifyIssue, sortIssues, filterTopPriority, triageIssues };
