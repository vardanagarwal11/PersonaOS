import { GoogleGenAI } from "@google/genai";
import { scoreProfile } from "./scoring.js";

/**
 * AI Semantic Engine (§5 of spec), backed by Gemini.
 *
 * - classifyTransactions: raw txn descriptions -> category + human meaning
 * - buildAiProfile: aggregated facts -> a profile object with confidence +
 *   reasoning (the exact shape that gets signed and anchored)
 *
 * Model ids are env-configurable because free-tier availability shifts; set
 * GEMINI_MODEL / GEMINI_EMBED_MODEL to whatever your key can call.
 */

const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || "text-embedding-004";

let _client;
function ai() {
  if (!_client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY not set");
    _client = new GoogleGenAI({ apiKey });
  }
  return _client;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The free tier throttles: 429 and 503 are routine, not exceptional. Retry them
 * with backoff rather than letting a transient spike fail the user's upload.
 * Anything else (a bad key, a bad schema) fails fast — retrying won't help.
 */
async function generateJson(prompt, responseSchema, attempt = 0) {
  const MAX_ATTEMPTS = 4;
  try {
    const res = await ai().models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { responseMimeType: "application/json", responseSchema },
    });
    const text = typeof res.text === "function" ? res.text() : res.text;
    if (!text) throw new Error("Gemini returned an empty response.");
    return JSON.parse(text);
  } catch (e) {
    const msg = String(e?.message || e);
    const transient = /429|503|overload|rate.?limit|unavailable|high demand|timeout|ECONN/i.test(msg);
    if (transient && attempt < MAX_ATTEMPTS - 1) {
      await sleep(2 ** attempt * 1000 + Math.floor(attempt * 250)); // 1s, 2s, 4s
      return generateJson(prompt, responseSchema, attempt + 1);
    }
    if (transient) throw new Error("The AI service is busy right now. Try again in a moment.");
    throw e;
  }
}

// --- 5.1 transaction classification (batched) ---

const CLASSIFY_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string" },
      category: { type: "string" },
      meaning: { type: "string" },
      confidence: { type: "number" },
    },
    required: ["id", "category", "meaning", "confidence"],
  },
};

/**
 * Classify a batch of transactions. Only unclassified txns should be passed;
 * results are meant to be cached in the vault so we never re-call for unchanged
 * data (free-tier rate limits, §5.4). Batch ~50-100 per call.
 */
export async function classifyTransactions(transactions) {
  if (!transactions.length) return [];
  const compact = transactions.map((t) => ({
    id: t.id,
    date: t.date,
    amount: t.amount,
    currency: t.currency,
    desc: t.rawDescription,
  }));
  const prompt = [
    "You classify personal bank transactions into economic meaning.",
    "For each transaction return: category (one of: salary, freelance, tuition, rent,",
    "medical, groceries, utilities, subscription, transfer, investment, loan_repayment,",
    "shopping, dining, travel, other), a short human-readable meaning, and a confidence 0-1.",
    "Positive amount = credit (money in), negative = debit (money out).",
    "Return a JSON array, one object per input transaction, preserving ids.",
    "",
    JSON.stringify(compact),
  ].join("\n");
  return generateJson(prompt, CLASSIFY_SCHEMA);
}

// --- 5.3 profile generation ---

const PROFILE_SCHEMAS = {
  loan: {
    type: "object",
    properties: {
      monthlyIncome: { type: "number" },
      incomeStability: { type: "number" },
      debtRatio: { type: "number" },
      savingsTrend: { type: "string", enum: ["up", "flat", "down"] },
      repaymentConsistency: { type: "number" },
      confidence: { type: "number" },
      reasoning: { type: "array", items: { type: "string" } },
    },
    required: ["confidence", "reasoning"],
  },
  hiring: {
    type: "object",
    properties: {
      incomeStability: { type: "number" },
      verifiedRoles: { type: "number" },
      projectCompletion: { type: "number" },
      reputation: { type: "number" },
      confidence: { type: "number" },
      reasoning: { type: "array", items: { type: "string" } },
    },
    required: ["confidence", "reasoning"],
  },
  freelancer: {
    type: "object",
    properties: {
      avgMonthlyFreelanceIncome: { type: "number" },
      clientRepeatRate: { type: "number" },
      onTimeDelivery: { type: "number" },
      confidence: { type: "number" },
      reasoning: { type: "array", items: { type: "string" } },
    },
    required: ["confidence", "reasoning"],
  },
  insurance: {
    type: "object",
    properties: {
      financialResilience: { type: "number" },
      riskBehavior: { type: "string", enum: ["low", "medium", "high"] },
      confidence: { type: "number" },
      reasoning: { type: "array", items: { type: "string" } },
    },
    required: ["confidence", "reasoning"],
  },
};

const PROFILE_INTENT = {
  loan: "assess loan creditworthiness: income, income stability, debt ratio, savings trend, repayment consistency",
  hiring: "assess a hiring profile: income stability, verified roles, project completion, reputation",
  freelancer: "assess a freelancer: average freelance income, client repeat rate, on-time delivery",
  insurance: "assess insurance risk: financial resilience and risk behavior",
};

// Reasoning is the only thing Gemini produces now — the numbers are fixed.
const REASONING_SCHEMA = {
  type: "object",
  properties: { reasoning: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 } },
  required: ["reasoning"],
};

/**
 * Build a profile from aggregated facts.
 *
 * The scored fields (confidence, ratios, trends) are computed deterministically
 * by scoreProfile — same facts always give the same numbers, and they're
 * auditable. Gemini is handed those FINAL numbers and only writes the
 * human-readable reasoning that explains them. It never decides a score, so it
 * can't inflate or hallucinate one.
 */
export async function buildAiProfile(profileType, { subjectPub, facts }) {
  if (!PROFILE_SCHEMAS[profileType]) throw new Error(`unknown profile type: ${profileType}`);

  const scored = scoreProfile(profileType, facts);

  const prompt = [
    `You are an explainable financial analyst. ${PROFILE_INTENT[profileType]}.`,
    "The assessment below has ALREADY been computed. Do NOT change any number.",
    "Write 3-5 short, concrete, human-readable reasoning bullets that explain",
    "these results by citing the underlying facts. Be honest about weaknesses",
    "(e.g. thin history lowers confidence). Reference real figures from FACTS.",
    "",
    "COMPUTED RESULT:",
    JSON.stringify(scored, null, 2),
    "",
    "FACTS:",
    JSON.stringify(facts, null, 2),
  ].join("\n");

  let reasoning;
  try {
    ({ reasoning } = await generateJson(prompt, REASONING_SCHEMA));
  } catch {
    // If the model is unreachable, fall back to a factual, non-AI explanation
    // rather than failing — the numbers (which matter) are already computed.
    reasoning = fallbackReasoning(profileType, scored, facts);
  }

  // Drop any null/unmeasured fields so the signed profile only asserts what we
  // could actually measure.
  const clean = Object.fromEntries(Object.entries(scored).filter(([, v]) => v != null && v !== "unknown"));
  return { profileType, subject: subjectPub, version: 1, ...clean, reasoning };
}

function fallbackReasoning(type, scored, f) {
  const out = [
    `Assessment based on ${f.txnCount} transactions across ${f.monthsOfHistory} month(s) of history.`,
  ];
  if (scored.confidence != null) out.push(`Overall confidence computed at ${Math.round(scored.confidence * 100)}%.`);
  if (f.monthsOfHistory <= 1) out.push("Confidence is capped: only one month of history is available.");
  if (scored.debtRatio != null) out.push(`Debt-to-income ratio is approximately ${Math.round(scored.debtRatio * 100)}%.`);
  if (scored.savingsTrend) out.push(`Net cash flow trend is ${scored.savingsTrend}.`);
  return out.slice(0, 5);
}

// --- 5.2 embeddings for economic-memory recall ---

export async function embed(text) {
  const res = await ai().models.embedContent({ model: EMBED_MODEL, contents: text });
  return res.embeddings?.[0]?.values || res.embedding?.values || [];
}

/**
 * Aggregate classified transactions into the compact "facts" the profile
 * generator consumes. Pure computation — no AI call, no raw descriptions leak
 * beyond category rollups.
 */
export function aggregateFacts(record) {
  const txns = record.transactions || [];
  const byCat = {};
  let credits = 0,
    debits = 0;

  // Per-month rollups drive the stability and trend signals in scoring.
  const monthly = {}; // "YYYY-MM" -> { income, spend }
  for (const t of txns) {
    const cat = t.category || "unclassified";
    byCat[cat] = (byCat[cat] || 0) + t.amount;
    if (t.amount >= 0) credits += t.amount;
    else debits += -t.amount;

    const ym = (t.date || "").slice(0, 7);
    if (ym) {
      const m = (monthly[ym] ??= { income: 0, spend: 0 });
      if (t.amount >= 0) m.income += t.amount;
      else m.spend += -t.amount;
    }
  }

  const salaryTxns = txns.filter((t) => t.category === "salary" && t.amount > 0);
  const monthKeys = Object.keys(monthly).sort();
  const incomeSeries = monthKeys.map((k) => round(monthly[k].income));
  const netSeries = monthKeys.map((k) => round(monthly[k].income - monthly[k].spend));

  // count of months where a bill/rent/EMI category went out — used for
  // repayment consistency (did recurring obligations get paid each month?)
  const obligationMonths = monthKeys.filter((k) =>
    txns.some(
      (t) => (t.date || "").slice(0, 7) === k && t.amount < 0 && /rent|loan_repayment|utilities/.test(t.category || "")
    )
  ).length;

  return {
    totalCredits: round(credits),
    totalDebits: round(debits),
    netFlow: round(credits - debits),
    byCategory: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, round(v)])),
    salaryCount: salaryTxns.length,
    avgSalary: salaryTxns.length ? round(salaryTxns.reduce((a, t) => a + t.amount, 0) / salaryTxns.length) : 0,
    monthsOfHistory: monthKeys.length || monthSpan(txns),
    monthlyIncome: incomeSeries,
    monthlyNet: netSeries,
    obligationMonths,
    txnCount: txns.length,
    verifiedRoles: (record.work || []).filter((w) => w.verified).length,
    totalRoles: (record.work || []).length,
    skills: (record.skills || []).map((s) => s.name),
    freelanceTotal: round(Math.abs(byCat.freelance || 0)),
    freelanceMonths: monthKeys.filter((k) =>
      txns.some((t) => (t.date || "").slice(0, 7) === k && t.category === "freelance" && t.amount > 0)
    ).length,
  };
}

function monthSpan(txns) {
  const dates = txns.map((t) => Date.parse(t.date)).filter((n) => !Number.isNaN(n));
  if (dates.length < 2) return dates.length;
  const months = (Math.max(...dates) - Math.min(...dates)) / (1000 * 60 * 60 * 24 * 30);
  return Math.max(1, Math.round(months));
}

const round = (n) => Math.round(n * 100) / 100;
