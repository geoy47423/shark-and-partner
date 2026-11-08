import React, { useState } from "react";

// ====== 1. SETUP ======
// Paste your Anthropic API key here. Keep this sandbox PRIVATE.

const MODEL = "claude-sonnet-4-6";
const MAX_QUESTIONS = 15; // questions per session
const MAX_SESSIONS = 2; // sessions per week (counted in this browser)

// ====== 2. THE AGENT'S BRAIN (one agent, two faces) ======
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

ENDING:
- When you have a complete picture (or the user asks to finish),
  set "done": true and make "message" a warm wrap-up telling them
  their plan is ready in the Plan tab.
  BUILD MY PLAN MODE:
- If a user message starts with "BUILD MY PLAN:", it lists the options
  the USER chose. Reply in the SAME JSON format, but make "plan" a plan
  built around THEIR chosen options (be realistic - if a choice is risky,
  say so inside "holes"). Set "message" to one warm sentence about their
  choices, set "partner" options to [], and set "done" to true.
`;

// ====== 3. TALKING TO THE AI (Claude API) ======
async function askAgent(history) {
  const response = await fetch("/.netlify/functions/shark", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: history }),
  });
  const data = await response.json();
  const text = data.content[0].text;
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ====== 4. SESSIONS LEFT (remembered in this browser, per week) ======
function weekKey() {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return now.getFullYear() + "-w" + week;
}
function readSessionsLeft() {
  try {
    const saved = JSON.parse(localStorage.getItem("sharkSessions") || "{}");
    if (saved.week === weekKey()) return saved.left;
  } catch (e) {}
  return MAX_SESSIONS;
}
function saveSessionsLeft(left) {
  try {
    localStorage.setItem(
      "sharkSessions",
      JSON.stringify({ week: weekKey(), left: left })
    );
  } catch (e) {}
}

// ====== 5. THE APP ======
export default function App() {
  const [tab, setTab] = useState("investor"); // investor | partner | plan
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [pitch, setPitch] = useState("");
  const [answer, setAnswer] = useState("");
  const [history, setHistory] = useState([]);
  const [chat, setChat] = useState([]);
  const [blocks, setBlocks] = useState([]); // partner critiques + options
  const [selected, setSelected] = useState({}); // which options you ticked
  const [customPlan, setCustomPlan] = useState(null); // your own plan
  const [building, setBuilding] = useState(false);
  const [plan, setPlan] = useState(null);
  const [questionsLeft, setQuestionsLeft] = useState(MAX_QUESTIONS);
  const [sessionsLeft, setSessionsLeft] = useState(readSessionsLeft());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function sendTurn(userText, isFirstPitch) {
    setLoading(true);
    setError("");
    const newHistory = [...history, { role: "user", content: userText }];
    try {
      const result = await askAgent(newHistory);
      newHistory.push({ role: "assistant", content: JSON.stringify(result) });
      setHistory(newHistory);
      setChat((c) => [
        ...c,
        { who: "you", text: userText },
        { who: "ai", text: result.message },
      ]);
      if (
        result.partner &&
        result.partner.options &&
        result.partner.options.length
      ) {
        setBlocks((b) => [
          ...b,
          {
            critique: result.partner.critique,
            options: result.partner.options.map((o, i) => ({
              ...o,
              id: b.length + "-" + i,
            })),
          },
        ]);
      }
      if (result.plan) setPlan(result.plan);
      if (isFirstPitch) {
        const left = sessionsLeft - 1;
        setSessionsLeft(left);
        saveSessionsLeft(left);
        setStarted(true);
      } else {
        setQuestionsLeft((q) => q - 1);
      }
      if (result.done || (!isFirstPitch && questionsLeft - 1 <= 0)) {
        setFinished(true);
      }
    } catch (e) {
      setError("Something went wrong. Check your API key and try again.");
    }
    setLoading(false);
  }

  function handlePitch() {
    if (!pitch.trim() || sessionsLeft <= 0) return;
    sendTurn("Here is my business pitch: " + pitch, true);
    setPitch("");
  }
  function handleAnswer() {
    if (!answer.trim()) return;
    sendTurn(answer, false);
    setAnswer("");
  }
  function downloadPDF() {
    window.print(); // in the print window, choose "Save as PDF"
  }
  function toggle(id) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }
  function chosenOptions() {
    return blocks.flatMap((b) => b.options).filter((o) => selected[o.id]);
  }

  // one extra AI call - does NOT use up a question
  async function buildMyPlan() {
    const chosen = chosenOptions();
    if (chosen.length === 0) return;
    setBuilding(true);
    setError("");
    const msg =
      "BUILD MY PLAN: I choose these solutions: " +
      chosen.map((o) => o.title + " (" + o.detail + ")").join("; ") +
      ". Rebuild my business plan around my choices.";
    try {
      const result = await askAgent([
        ...history,
        { role: "user", content: msg },
      ]);
      if (result.plan) setCustomPlan(result.plan);
      setTab("plan");
    } catch (e) {
      setError("Couldn't build your plan. Try again.");
    }
    setBuilding(false);
  }

  // ====== STYLES (matching the mockup) ======
  const navy = "#002b94ff";
  const mid = "#2E6FDE";
  const light = "#93d5ff";
  const pale = "#EAF5FE";
  const script = "'Dancing Script', 'Brush Script MT', cursive";

  const styles = {
    frame: {
      backgroundColor: navy,
      minHeight: "100vh",
      margin: 0,
      padding: 16,
      boxSizing: "border-box",
      fontFamily: "Georgia, serif",
    },
    card: {
      backgroundColor: "#FFFFFF",
      border: "10px solid " + light,
      borderRadius: 16,
      maxWidth: "94%",
      margin: "0 auto",
      padding: 24,
      minHeight: "90vh",
      boxSizing: "border-box",
    },
    headerRow: {
      position: "relative",
      textAlign: "center",
    },
    title: {
      fontFamily: script,
      color: navy,
      fontSize: 38,
      margin: 0,
      whiteSpace: "nowrap",
    },
    counters: {
      fontFamily: script,
      color: mid,
      fontSize: 30,
      lineHeight: 1.4,
      position: "absolute",
      top: 0,
      right: 0,
      textAlign: "right",
    },
    tagline: {
      textAlign: "center",
      fontSize: 15.5,
      fontWeight: "normal",
      color: "#3A3A3A",
      lineHeight: 1.6,
      margin: "30px auto 0",
      maxWidth: 680,
    },
    taglineLead: {
      color: mid,
      fontWeight: "bold",
    },
    tabs: {
      display: "flex",
      justifyContent: "center",
      gap: 30,
      margin: "34px 0 18px",
    },
    tab: (active) => ({
      fontFamily: script,
      fontSize: 26,
      padding: "8px 36px",
      borderRadius: 6,
      border: "2px solid " + navy,
      cursor: "pointer",
      backgroundColor: active ? navy : "#FFFFFF",
      color: active ? "#FFFFFF" : navy,
    }),
    bubbleRow: (who) => ({
      display: "flex",
      justifyContent: who === "ai" ? "flex-start" : "flex-end",
      alignItems: "flex-end",
      gap: 8,
      margin: "12px 0",
    }),
    bubble: (who) => ({
      fontFamily: script,
      fontSize: 22,
      lineHeight: 1.3,
      maxWidth: "70%",
      padding: "10px 16px",
      borderRadius: 10,
      border: "2px solid " + light,
      backgroundColor: who === "ai" ? light : navy,
      color: who === "ai" ? navy : "#FFFFFF",
    }),
    avatar: {
      fontSize: 34,
    },
    textarea: {
      width: "100%",
      maxWidth: 560,
      display: "block",
      margin: "0 auto",
      minHeight: 70,
      padding: 10,
      fontSize: 15,
      boxSizing: "border-box",
      border: "2px solid " + light,
      borderRadius: 8,
    },
    button: {
      backgroundColor: navy,
      color: "#FFFFFF",
      border: "none",
      padding: "10px 24px",
      borderRadius: 8,
      fontSize: 16,
      display: "block",
      margin: "10px auto 0",
      cursor: "pointer",
      fontFamily: script,
    },
    planHeading: {
      fontFamily: script,
      color: mid,
      fontSize: 26,
      marginBottom: 4,
    },

    planCard: {
      border: "3px solid " + light,
      borderRadius: 12,
      padding: "6px 18px 16px",
      margin: "14px 0",
    },

    option: (on) => ({
      display: "flex",
      alignItems: "flex-start",
      gap: 10,
      backgroundColor: on ? light : "#FFFFFF",
      border: "2px solid " + (on ? mid : light),
      borderRadius: 8,
      padding: "8px 12px",
      margin: "8px 0",
      cursor: "pointer",
      fontSize: 15.5,
      fontFamily: "Georgia, serif",
    }),

    tip: {
      backgroundColor: pale,
      border: "2px solid " + light,
      borderRadius: 10,
      padding: "10px 14px",
      margin: "10px 0",
      fontSize: 16,
    },
  };
  return (
    <div style={styles.frame}>
      {/* load the script font + print rules */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600;700&display=swap');
        body { margin: 0; background-color: #1B3C8C; }
        @media print {
          body * { visibility: hidden; }
          #plan-area, #plan-area * { visibility: visible; }
          #plan-area { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>

      <div style={styles.card}>
        {/* HEADER */}
        <div style={styles.headerRow}>
          <h1 style={styles.title}>
            <img
              src="robot.png"
              alt=""
              style={{ height: 52, verticalAlign: "middle" }}
            />{" "}
            Shark &amp; Partner{" "}
            <img
              src="user.png"
              alt=""
              style={{ height: 52, verticalAlign: "middle" }}
            />
          </h1>
          <div style={styles.counters}>
            {sessionsLeft} Sessions Left
            <br />
            {questionsLeft} Questions Left
          </div>
        </div>

        <p style={styles.tagline}>
          <span style={styles.taglineLead}>Pitch your idea.</span> Get grilled
          by an AI investor, coached by an AI partner, and walk away with your
          upgraded business plan as a downloadable PDF. 15 questions. 2 sessions
          a week.
        </p>

        {/* TABS */}
        <div style={styles.tabs}>
          <button
            style={styles.tab(tab === "investor")}
            onClick={() => setTab("investor")}
          >
            Investor
          </button>
          <button
            style={styles.tab(tab === "partner")}
            onClick={() => setTab("partner")}
          >
            Partner
          </button>
          <button
            style={styles.tab(tab === "plan")}
            onClick={() => setTab("plan")}
          >
            Plan
          </button>
        </div>

        {/* INVESTOR TAB */}
        {tab === "investor" && (
          <div>
            {!started && (
              <div>
                <textarea
                  style={styles.textarea}
                  placeholder="Type your business pitch here..."
                  value={pitch}
                  onChange={(e) => setPitch(e.target.value)}
                />
                <button
                  style={styles.button}
                  onClick={handlePitch}
                  disabled={loading || sessionsLeft <= 0}
                >
                  {sessionsLeft <= 0
                    ? "No sessions left this week"
                    : loading
                    ? "The investor is thinking..."
                    : "Pitch it"}
                </button>
              </div>
            )}

            {chat.map((m, i) => (
              <div key={i} style={styles.bubbleRow(m.who)}>
                {m.who === "ai" && (
                  <img src="robot.png" alt="" style={{ width: 54 }} />
                )}
                <div style={styles.bubble(m.who)}>{m.text}</div>
                {m.who === "you" && (
                  <img src="user.png" alt="" style={{ width: 54 }} />
                )}
              </div>
            ))}

            {started && !finished && (
              <div>
                <textarea
                  style={styles.textarea}
                  placeholder="Your answer... (or say: I don't know, any suggestions?)"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                />
                <button
                  style={styles.button}
                  onClick={handleAnswer}
                  disabled={loading}
                >
                  {loading ? "Thinking..." : "Answer"}
                </button>
              </div>
            )}

            {finished && (
              <p style={{ textAlign: "center", fontSize: 17 }}>
                🎉 Session complete — your plan is ready in the <b>Plan</b> tab!
              </p>
            )}
          </div>
        )}

        {/* PARTNER TAB */}
        {tab === "partner" && (
          <div>
            {blocks.length === 0 && (
              <p style={{ textAlign: "center" }}>
                After each investor question, your partner will drop 2–3
                possible fixes here. Tick the ones YOU like — any combo — then
                press <b>Build My Plan</b>.
              </p>
            )}

            {blocks.map((b, i) => (
              <div key={i} style={styles.tip}>
                🤝 <b>After question {i + 1}:</b> {b.critique}
                {b.options.map((o) => (
                  <label key={o.id} style={styles.option(!!selected[o.id])}>
                    <input
                      type="checkbox"
                      checked={!!selected[o.id]}
                      onChange={() => toggle(o.id)}
                    />
                    <span>
                      <b>{o.title}</b> — {o.detail}
                    </span>
                  </label>
                ))}
              </div>
            ))}

            {blocks.length > 0 && (
              <button
                style={styles.button}
                onClick={buildMyPlan}
                disabled={building || chosenOptions().length === 0}
              >
                {building
                  ? "Your partner is building it..."
                  : chosenOptions().length === 0
                  ? "Tick some options first"
                  : "✨ Build My Plan (" + chosenOptions().length + " picked)"}
              </button>
            )}
          </div>
        )}

        {/* PLAN TAB */}
        {tab === "plan" && (
          <div id="plan-area">
            {!plan && (
              <p style={{ textAlign: "center" }}>
                Your living business plan will grow here with every answer.
              </p>
            )}
            {plan && (
              <div>
                <div style={styles.planCard}>
                  <h2 style={{ fontFamily: script, color: navy, fontSize: 32 }}>
                    ⭐ Shark's Recommended Plan
                  </h2>
                  <p>{plan.summary}</p>
                  <h3 style={styles.planHeading}>Holes</h3>
                  <ul>
                    {plan.holes.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                  <h3 style={styles.planHeading}>Solutions</h3>
                  <ul>
                    {plan.solutions.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                  <h3 style={styles.planHeading}>Where to Promote</h3>
                  <ul>
                    {plan.platforms.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                  <h3 style={styles.planHeading}>Next Steps</h3>
                  <ul>
                    {plan.next_steps.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>

                <div style={styles.planCard}>
                  <h2 style={{ fontFamily: script, color: navy, fontSize: 32 }}>
                    🤝 Your Plan
                  </h2>
                  {customPlan ? (
                    <div>
                      <p>{customPlan.summary}</p>
                      <h3 style={styles.planHeading}>Holes</h3>
                      <ul>
                        {customPlan.holes.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                      <h3 style={styles.planHeading}>Solutions</h3>
                      <ul>
                        {customPlan.solutions.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                      <h3 style={styles.planHeading}>Where to Promote</h3>
                      <ul>
                        {customPlan.platforms.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                      <h3 style={styles.planHeading}>Next Steps</h3>
                      <ul>
                        {customPlan.next_steps.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p>
                      This one is yours to shape: tick the fixes you like in the{" "}
                      <b>Partner</b> tab, then press <b>✨ Build My Plan</b> —
                      your partner will rebuild the plan around YOUR choices.
                    </p>
                  )}
                </div>

                <button
                  style={styles.button}
                  onClick={downloadPDF}
                  className="no-print"
                >
                  ⬇ Download as PDF
                </button>
              </div>
            )}
          </div>
        )}

        {error && (
          <p style={{ color: "#B00020", textAlign: "center" }}>{error}</p>
        )}
      </div>
    </div>
  );
}
