/**
 * Profile builders. In the MVP these return mock data so the crypto + chain
 * loop can be exercised end to end. The Gemini engine (§5.3) will later replace
 * the bodies of these functions, but the OUTPUT SHAPE must stay identical —
 * these objects are what gets signed and anchored.
 */

export const PROFILE_TYPES = ["loan", "hiring", "freelancer", "insurance"];

export function buildProfile(profileType, { subjectPub }) {
  const base = { profileType, subject: subjectPub, version: 1 };
  switch (profileType) {
    case "loan":
      return {
        ...base,
        monthlyIncome: 85000,
        incomeStability: 0.92,
        debtRatio: 0.18,
        savingsTrend: "up",
        repaymentConsistency: 0.97,
        confidence: 0.94,
        reasoning: [
          "Stable monthly salary credits over 12 months",
          "Zero missed EMI or bill payments",
          "Savings balance trending upward",
          "Debt-to-income ratio well below 0.35",
        ],
      };
    case "hiring":
      return {
        ...base,
        incomeStability: 0.9,
        verifiedRoles: 2,
        projectCompletion: 0.95,
        reputation: 0.88,
        confidence: 0.9,
        reasoning: ["Verified employment history", "High project completion rate"],
      };
    case "freelancer":
      return {
        ...base,
        avgMonthlyFreelanceIncome: 32000,
        clientRepeatRate: 0.6,
        onTimeDelivery: 0.93,
        confidence: 0.86,
        reasoning: ["Recurring freelance credits", "Strong repeat-client ratio"],
      };
    case "insurance":
      return {
        ...base,
        financialResilience: 0.8,
        riskBehavior: "low",
        confidence: 0.82,
        reasoning: ["Emergency buffer present", "Low volatility in spending"],
      };
    default:
      throw new Error(`unknown profile type: ${profileType}`);
  }
}
