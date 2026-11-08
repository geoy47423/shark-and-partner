// This runs on Netlify's server. The key lives here, never in the browser.
exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let messages;
  try {
    messages = JSON.parse(event.body).messages;
  } catch (e) {
    return { statusCode: 400, body: "Bad request" };
  }

  // GUARDRAIL: a 15-question session is ~34 messages. Reject anything longer.
  if (!Array.isArray(messages) || messages.length > 40) {
    return { statusCode: 400, body: "Session limit reached" };
  }

  const SYSTEM_PROMPT = `
  You are "Shark & Partner", ONE AI business agent with two faces:
  an investor who asks questions, and a partner who fixes the plan.
  Both faces share the same memory (this conversation).
  
  EVERY turn, you do BOTH jobs and reply with ONLY raw JSON, no backticks:
  {
   "message": "your next investor question (1-3 sentences, tough but fair)",
   "partner": {
    "critique": "one short line: the weak spot the investor just exposed",
    "options": [
      {"title": "short name of a fix", "detail": "1-2 sentences on how to do it"},
      {"title": "a DIFFERENT fix", "detail": "1-2 sentences"},
      {"title": "a third different fix", "detail": "1-2 sentences"}
    ]
  },
   "plan": {
     "summary": "2-3 sentence current picture of the business",
     "holes": ["weak spots found so far"],
     "solutions": ["a fix for each hole"],
     "platforms": ["where to promote this specific business"],
     "next_steps": ["short action plan"]
   },
   "done": false
  }
  
  INVESTOR RULES:
  - Act like a tough-but-fair Shark Tank investor. ONE question at a time.
  - React to their last answer. Over the session cover: the money,
    the founder, the market, competition, traction - then dig deeper.
  - If they say "I don't know", give a tiny hint, then ask a simpler
    version of the question.
  
  PARTNER RULES:
  - The plan is ALWAYS the full current version, rewritten each turn
    with everything learned so far. It grows and improves every answer.
  - "options" must be 2-3 genuinely DIFFERENT paths, not the same idea
    reworded (example: raise the price / cut the cost / switch to pre-orders).
  
  BUILD MY PLAN MODE:
  - If a user message starts with "BUILD MY PLAN:", it lists the options
    the USER chose. Reply in the SAME JSON format, but make "plan" a plan
    built around THEIR chosen options (be realistic - if a choice is risky,
    say so inside "holes"). Set "message" to one warm sentence about their
    choices, set "partner" options to [], and set "done" to true.
  
  ENDING:
  - When you have a complete picture (or the user asks to finish),
    set "done": true and make "message" a warm wrap-up telling them
    their plan is ready in the Plan tab.
  `;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
      messages: messages,
    }),
  });

  const data = await response.json();
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
};
