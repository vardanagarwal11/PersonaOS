import { signTransaction, getNetworkDetails } from "@stellar/freighter-api";

export const API = process.env.NEXT_PUBLIC_API || "http://localhost:4000";

export async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      headers: { "content-type": "application/json" },
      ...opts,
    });
  } catch {
    // The server is the only thing on the other side of this call, so a network
    // failure means one thing: it isn't running.
    throw new Error("PersonaOS can't reach its server. Make sure the backend is running.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `The server returned ${res.status}.`);
  return body;
}

/* Wallet connection lives in app/wallet.js — it owns the typed error states. */

/**
 * Full consent flow with real Freighter signing:
 * 1. server builds unsigned grant_consent XDR
 * 2. Freighter signs it (subject's own key)
 * 3. server submits signed XDR to Soroban
 */
export async function grantConsent(subjectPub, type) {
  const { xdr } = await api("/consent/build", {
    method: "POST",
    body: JSON.stringify({ subjectPub, type }),
  });

  let signedTxXdr;
  try {
    const net = await getNetworkDetails();
    const signed = await signTransaction(xdr, {
      networkPassphrase: net.networkPassphrase,
      address: subjectPub,
    });
    if (signed.error) throw new Error(typeof signed.error === "string" ? signed.error : signed.error.message);
    signedTxXdr = signed.signedTxXdr;
  } catch (e) {
    const m = String(e?.message || e).toLowerCase();
    if (m.includes("declin") || m.includes("reject") || m.includes("denied") || m.includes("cancel")) {
      throw new Error("You declined the signature, so nothing was issued. Approve it in Freighter to continue.");
    }
    throw new Error("Freighter couldn't sign the consent. Check that it's unlocked and set to Testnet.");
  }

  const { hash } = await api("/consent/submit", {
    method: "POST",
    body: JSON.stringify({ signedXdr: signedTxXdr }),
  });
  return hash;
}

export function issueProfile(subjectPub, type, nonce = Date.now()) {
  return api(`/persona/${type}`, {
    method: "POST",
    body: JSON.stringify({ subjectPub, nonce }),
  });
}

export const verify = (id) => api(`/verify/${id}`);
export const revoke = (id) => api(`/revoke/${id}`, { method: "POST" });
export const list = (subject) => api(`/list${subject ? `?subject=${subject}` : ""}`);

/* ---- Vault + ingestion ---- */

export const getVault = (subject) => api(`/vault/${subject}`);

/** Bank CSV is multipart, so it bypasses the JSON `api` helper. */
export async function ingestBank(subjectPub, file) {
  const form = new FormData();
  form.append("subjectPub", subjectPub);
  form.append("file", file);
  const res = await fetch(`${API}/ingest/bank`, { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export const ingestGithub = (subjectPub, username) =>
  api("/ingest/github", { method: "POST", body: JSON.stringify({ subjectPub, username }) });

export const ingestResume = (subjectPub, text) =>
  api("/ingest/resume", { method: "POST", body: JSON.stringify({ subjectPub, text }) });
