import { parse as parseCsv } from "csv-parse/sync";
import { createHash } from "node:crypto";

/**
 * Ingestion + normalization (§4 of spec). Every raw source is parsed into a
 * partial UserVaultRecord with canonical shapes. Identifiers (account numbers,
 * etc.) are stripped here so they never reach the AI engine.
 */

const txId = (date, amount, desc) =>
  createHash("sha256").update(`${date}|${amount}|${desc}`).digest("hex").slice(0, 24);

/**
 * Bank statement CSV -> Transaction[].
 * Expects headers containing date / description / amount, OR separate
 * debit/credit columns. Case-insensitive, tolerant of common bank exports.
 */
export function parseBankCsv(csvText, currency = "INR") {
  const rows = parseCsv(csvText, {
    columns: (header) => header.map((h) => h.trim().toLowerCase()),
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });

  const pick = (row, keys) => {
    for (const k of keys) if (row[k] != null && row[k] !== "") return row[k];
    return undefined;
  };
  const num = (v) => (v == null ? 0 : Number(String(v).replace(/[,₹$\s]/g, "")) || 0);

  const transactions = [];
  for (const row of rows) {
    const date = pick(row, ["date", "txn date", "transaction date", "value date"]);
    const desc = pick(row, ["description", "narration", "particulars", "details", "remarks"]) || "";
    if (!date) continue;

    let amount = pick(row, ["amount", "amt"]);
    if (amount != null) {
      amount = num(amount); // may already be signed
    } else {
      const debit = num(pick(row, ["debit", "withdrawal", "withdrawal amt", "dr"]));
      const credit = num(pick(row, ["credit", "deposit", "deposit amt", "cr"]));
      amount = credit - debit; // + credit, - debit (spec convention)
    }
    if (!amount) continue;

    transactions.push({
      id: txId(date, amount, desc),
      date: normalizeDate(date),
      amount,
      currency,
      rawDescription: String(desc).slice(0, 160),
      source: "bank",
    });
  }
  return { transactions, uploadsMeta: [{ type: "bank-csv", uploadedAt: new Date().toISOString() }] };
}

function normalizeDate(d) {
  // best-effort ISO; leave as-is if unparseable (AI can still read it)
  const t = Date.parse(d);
  return Number.isNaN(t) ? String(d) : new Date(t).toISOString().slice(0, 10);
}

/** GitHub public profile + repos -> WorkHistory/Skill signals (no token needed). */
export async function parseGithub(username) {
  const base = "https://api.github.com";
  const [user, repos] = await Promise.all([
    fetch(`${base}/users/${username}`).then((r) => r.json()),
    fetch(`${base}/users/${username}/repos?per_page=100&sort=updated`).then((r) => r.json()),
  ]);
  if (user.message) throw new Error(`GitHub: ${user.message}`);

  const langs = {};
  let stars = 0;
  for (const repo of Array.isArray(repos) ? repos : []) {
    if (repo.language) langs[repo.language] = (langs[repo.language] || 0) + 1;
    stars += repo.stargazers_count || 0;
  }
  const skills = Object.entries(langs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, evidence: `${count} public repos`, source: "github" }));

  return {
    skills,
    work: [
      {
        source: "github",
        role: "Open-source contributor",
        org: `@${username}`,
        start: (user.created_at || "").slice(0, 10),
        verified: true,
      },
    ],
    uploadsMeta: [
      {
        type: "github",
        uploadedAt: new Date().toISOString(),
        publicRepos: user.public_repos,
        followers: user.followers,
        stars,
      },
    ],
  };
}

/* Résumé extraction lives in gemini.js (extractResume) — it needs the model to
   turn free text into structured work + skills. */

/**
 * LinkedIn official data export: user downloads their archive ZIP from
 * LinkedIn and we read Positions.csv / Skills.csv from it. This is the legal,
 * user-owned path — LinkedIn has no open API and scraping is off-limits (§4).
 * Accepts the already-extracted CSV texts.
 */
export function parseLinkedInExport({ positionsCsv, skillsCsv }) {
  const out = { work: [], skills: [], uploadsMeta: [{ type: "linkedin", uploadedAt: new Date().toISOString() }] };
  if (positionsCsv) {
    const rows = parseCsv(positionsCsv, { columns: (h) => h.map((x) => x.trim().toLowerCase()), skip_empty_lines: true, relax_column_count: true });
    for (const r of rows) {
      if (!r["company name"] && !r.title) continue;
      out.work.push({
        source: "linkedin",
        role: r.title || "",
        org: r["company name"] || "",
        start: r["started on"] || "",
        end: r["finished on"] || undefined,
        verified: false,
      });
    }
  }
  if (skillsCsv) {
    const rows = parseCsv(skillsCsv, { columns: (h) => h.map((x) => x.trim().toLowerCase()), skip_empty_lines: true, relax_column_count: true });
    for (const r of rows) {
      const name = r.name || r.skill;
      if (name) out.skills.push({ name, evidence: "LinkedIn export", source: "linkedin" });
    }
  }
  return out;
}
