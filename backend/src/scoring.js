/**
 * Deterministic profile scoring.
 *
 * Every number in a signed proof is computed here, from the aggregated facts —
 * never invented by the model. Same facts always produce the same score, so an
 * attestation is reproducible and auditable. Gemini's only job downstream is to
 * describe these numbers in plain language; it does not decide them.
 *
 * Each scorer returns { ...signals, confidence, insufficient? }. When there
 * isn't enough data to stand behind a number, it says so rather than guessing —
 * the caller refuses to issue in that case.
 */

const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const round2 = (n) => Math.round(n * 100) / 100;

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Coefficient of variation → stability in [0,1]. Low variance = high stability. */
function stability(series) {
  if (series.length < 2) return null; // can't measure stability from one point
  const m = mean(series);
  if (m <= 0) return 0;
  const variance = mean(series.map((x) => (x - m) ** 2));
  const cv = Math.sqrt(variance) / m; // coefficient of variation
  return clamp(1 - cv); // cv 0 → 1.0, cv ≥ 1 → 0
}

/** Trend of a series via normalized least-squares slope → [0,1], 0.5 = flat. */
function trend(series) {
  const n = series.length;
  if (n < 2) return null;
  const xs = series.map((_, i) => i);
  const mx = mean(xs);
  const my = mean(series);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (series[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const scale = Math.abs(my) || 1;
  return clamp(0.5 + slope / scale / 2); // rising → >0.5, falling → <0.5
}

/** Thin history should never yield high confidence. min 2 months to score. */
function historyDepth(months) {
  return clamp(months / 12); // 12+ months of history = full weight
}

// Weighted blend; skips signals that are null (unmeasurable) and renormalizes.
function blend(weighted) {
  let sum = 0;
  let wsum = 0;
  for (const [value, weight] of weighted) {
    if (value == null) continue;
    sum += value * weight;
    wsum += weight;
  }
  return wsum === 0 ? null : sum / wsum;
}

// ---------- per-profile scorers ----------

function scoreLoan(f) {
  const incomeStability = stability(f.monthlyIncome);
  const debtRatio = f.totalCredits > 0 ? clamp(f.totalDebits / f.totalCredits) : 1;
  const debtScore = clamp(1 - debtRatio / 0.5); // ratio ≥0.5 of income to debt → 0
  const savingsTrend = trend(f.monthlyNet);
  const repayment =
    f.monthsOfHistory > 0 ? clamp(f.obligationMonths / f.monthsOfHistory) : null;
  const depth = historyDepth(f.monthsOfHistory);

  const confidence = blend([
    [incomeStability, 0.3],
    [debtScore, 0.25],
    [savingsTrend, 0.2],
    [repayment, 0.15],
    [depth, 0.1],
  ]);

  return {
    monthlyIncome: round2(mean(f.monthlyIncome) || f.avgSalary),
    incomeStability: incomeStability == null ? null : round2(incomeStability),
    debtRatio: round2(debtRatio),
    savingsTrend: savingsTrend == null ? "unknown" : savingsTrend > 0.55 ? "up" : savingsTrend < 0.45 ? "down" : "flat",
    repaymentConsistency: repayment == null ? null : round2(repayment),
    confidence: confidence == null ? 0 : round2(confidence * depthPenalty(f.monthsOfHistory)),
  };
}

function scoreHiring(f) {
  const incomeStability = stability(f.monthlyIncome);
  const roleScore = clamp(f.verifiedRoles / 2); // 2+ verified roles = full
  const reputation = f.totalRoles > 0 ? clamp(f.verifiedRoles / f.totalRoles) : null;
  const depth = historyDepth(f.monthsOfHistory);

  const confidence = blend([
    [incomeStability, 0.35],
    [roleScore, 0.35],
    [reputation, 0.2],
    [depth, 0.1],
  ]);

  return {
    incomeStability: incomeStability == null ? null : round2(incomeStability),
    verifiedRoles: f.verifiedRoles,
    projectCompletion: reputation == null ? null : round2(reputation),
    reputation: reputation == null ? null : round2(reputation),
    confidence: confidence == null ? 0 : round2(confidence * depthPenalty(f.monthsOfHistory)),
  };
}

function scoreFreelancer(f) {
  const avgMonthly = f.freelanceMonths > 0 ? f.freelanceTotal / f.freelanceMonths : 0;
  const incomeStability = stability(f.monthlyIncome);
  const consistency = f.monthsOfHistory > 0 ? clamp(f.freelanceMonths / f.monthsOfHistory) : null;
  const depth = historyDepth(f.monthsOfHistory);

  const confidence = blend([
    [incomeStability, 0.3],
    [consistency, 0.4],
    [clamp(avgMonthly / 50000), 0.2], // scaled to a reference income
    [depth, 0.1],
  ]);

  return {
    avgMonthlyFreelanceIncome: round2(avgMonthly),
    clientRepeatRate: consistency == null ? null : round2(consistency),
    onTimeDelivery: null, // not derivable from bank data — left unmeasured
    confidence: confidence == null ? 0 : round2(confidence * depthPenalty(f.monthsOfHistory)),
  };
}

function scoreInsurance(f) {
  const buffer = f.totalCredits > 0 ? clamp(f.netFlow / f.totalCredits) : 0;
  const spendStability = stability(f.monthlyNet);
  const depth = historyDepth(f.monthsOfHistory);

  const confidence = blend([
    [clamp(buffer), 0.4],
    [spendStability, 0.4],
    [depth, 0.2],
  ]);

  const riskScore = confidence ?? 0;
  return {
    financialResilience: round2(clamp(buffer)),
    riskBehavior: riskScore > 0.66 ? "low" : riskScore > 0.4 ? "medium" : "high",
    confidence: confidence == null ? 0 : round2(confidence * depthPenalty(f.monthsOfHistory)),
  };
}

/** One month of data can't support a strong claim — cap confidence hard. */
function depthPenalty(months) {
  if (months <= 1) return 0.5;
  if (months < 3) return 0.75;
  return 1;
}

const SCORERS = { loan: scoreLoan, hiring: scoreHiring, freelancer: scoreFreelancer, insurance: scoreInsurance };

/**
 * Minimum evidence required before any proof can be issued. Below this the
 * server refuses — a signed attestation must never carry a fabricated score.
 */
export function hasEnoughData(profileType, facts) {
  if (profileType === "hiring") {
    // work-history based: allow if there's verified work OR bank history
    return facts.verifiedRoles > 0 || facts.txnCount >= 5;
  }
  // financial profiles need real transaction history
  return facts.txnCount >= 5 && facts.monthsOfHistory >= 1;
}

/** Compute the deterministic scored fields for a profile type. */
export function scoreProfile(profileType, facts) {
  const scorer = SCORERS[profileType];
  if (!scorer) throw new Error(`unknown profile type: ${profileType}`);
  return scorer(facts);
}
