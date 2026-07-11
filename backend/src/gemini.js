import { GoogleGenAI } from "@google/genai";

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

async function generateJson(prompt, responseSchema) {
  const res = await ai().models.generateContent({
    model: MODEL,
    contents: prompt,
    config: { responseMimeType: "application/json", responseSchema },
  });
  const text = typeof res.text === "function" ? res.text() : res.text;
  return JSON.parse(text);
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

/**
 * Generate a profile from aggregated economic-memory facts (NOT raw txns).
 * Output is the signed+anchored object; `reasoning` is the explainability
 * requirement, produced structurally.
 */
export async function buildAiProfile(profileType, { subjectPub, facts }) {
  const schema = PROFILE_SCHEMAS[profileType];
  if (!schema) throw new Error(`unknown profile type: ${profileType}`);

  const prompt = [
    `You are an explainable financial analyst. ${PROFILE_INTENT[profileType]}.`,
    "Base every number ONLY on the provided facts. Never invent data.",
    "Confidence 0-1 reflects how well the facts support the assessment.",
    "reasoning: 3-5 short, concrete, human-readable bullet points citing the facts.",
    "",
    "FACTS:",
    JSON.stringify(facts, null, 2),
  ].join("\n");

  const profile = await generateJson(prompt, schema);
  return { profileType, subject: subjectPub, version: 1, ...profile };
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
  for (const t of txns) {
    const cat = t.category || "unclassified";
    byCat[cat] = (byCat[cat] || 0) + t.amount;
    if (t.amount >= 0) credits += t.amount;
    else debits += -t.amount;
  }
  const salaryTxns = txns.filter((t) => t.category === "salary" && t.amount > 0);
  const monthsSpan = monthSpan(txns);
  return {
    totalCredits: round(credits),
    totalDebits: round(debits),
    netFlow: round(credits - debits),
    byCategory: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, round(v)])),
    salaryCount: salaryTxns.length,
    avgSalary: salaryTxns.length ? round(salaryTxns.reduce((a, t) => a + t.amount, 0) / salaryTxns.length) : 0,
    monthsOfHistory: monthsSpan,
    txnCount: txns.length,
    verifiedRoles: (record.work || []).filter((w) => w.verified).length,
    totalRoles: (record.work || []).length,
    skills: (record.skills || []).map((s) => s.name),
  };
}

function monthSpan(txns) {
  const dates = txns.map((t) => Date.parse(t.date)).filter((n) => !Number.isNaN(n));
  if (dates.length < 2) return dates.length;
  const months = (Math.max(...dates) - Math.min(...dates)) / (1000 * 60 * 60 * 24 * 30);
  return Math.max(1, Math.round(months));
}

const round = (n) => Math.round(n * 100) / 100;
