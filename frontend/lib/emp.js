import freighter from "@stellar/freighter-api";

const { signTransaction, signMessage, getNetworkDetails } = freighter;

export const API = process.env.NEXT_PUBLIC_API || "http://localhost:4000";

const TOKEN_KEY = "personaos.token";

/** Browsers have no Buffer; go through binary string to base64. */
function bytesToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin);
}

export const getToken = () =>
  typeof window === "undefined" ? null : sessionStorage.getItem(TOKEN_KEY);
export const setToken = (t) => sessionStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => sessionStorage.removeItem(TOKEN_KEY);

export async function api(path, opts = {}) {
  const token = getToken();
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      ...opts,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
    });
  } catch {
    // The server is the only thing on the other side of this call, so a network
    // failure means one thing: it isn't running.
    throw new Error("PersonaOS can't reach its server. Make sure the backend is running.");
  }

  if (res.status === 401) {
    clearToken();
    throw new Error("Your session expired. Connect your wallet again.");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `The server returned ${res.status}.`);
  return body;
}

/**
 * Prove to the server that this browser holds the address, by signing a nonce
 * with Freighter. The resulting token gates every vault and proof operation —
 * without it, anyone could write to anyone's economic memory.
 */
export async function signIn(address) {
  const { message } = await api("/auth/challenge", {
    method: "POST",
    body: JSON.stringify({ address }),
  });

  const signed = await signMessage(message, { address });
  if (signed?.error) {
    const m = String(signed.error.message || signed.error).toLowerCase();
    if (m.includes("declin") || m.includes("reject") || m.includes("cancel")) {
      throw new Error("You declined the signature, so you're not signed in.");
    }
    throw new Error("Freighter couldn't sign the request. Check that it's unlocked.");
  }

  // Freighter's shape shifts across versions: signedMessage may be a base64
  // string (v4), a Buffer/Uint8Array (v3), or a JSON'd Buffer ({data:[...]}).
  // Normalise all of them to a base64 string for the server.
  const raw = signed.signedMessage ?? signed.signedBlob ?? signed;
  let signature;
  if (typeof raw === "string") {
    signature = raw;
  } else if (raw?.data && Array.isArray(raw.data)) {
    signature = bytesToBase64(raw.data);
  } else {
    signature = bytesToBase64(raw);
  }
  if (!signature) throw new Error("Freighter returned no signature. Try reconnecting.");

  const { token } = await api("/auth/verify", {
    method: "POST",
    body: JSON.stringify({ address, signature }),
  });
  setToken(token);
  return token;
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

  const token = getToken();
  let res;
  try {
    res = await fetch(`${API}/ingest/bank`, {
      method: "POST",
      body: form,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw new Error("PersonaOS can't reach its server. Make sure the backend is running.");
  }

  if (res.status === 401) {
    clearToken();
    throw new Error("Your session expired. Connect your wallet again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `The server returned ${res.status}.`);
  return body;
}

export const ingestGithub = (subjectPub, username) =>
  api("/ingest/github", { method: "POST", body: JSON.stringify({ subjectPub, username }) });

export const ingestResume = (subjectPub, text) =>
  api("/ingest/resume", { method: "POST", body: JSON.stringify({ subjectPub, text }) });
