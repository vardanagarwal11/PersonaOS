"use client";
import { useState } from "react";
import { useWallet } from "./wallet";
import { grantConsent, issueProfile } from "../lib/emp";
import Seal from "./seal";

const TYPES = [
  ["loan", "Loan"],
  ["hiring", "Hiring"],
  ["freelancer", "Freelancer"],
  ["insurance", "Insurance"],
];

export default function Issue() {
  const { address, connect } = useWallet();
  const [type, setType] = useState("loan");
  const [step, setStep] = useState("idle"); // idle|consent|issue|done
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function run() {
    setError("");
    setResult(null);
    try {
      setStep("consent");
      await grantConsent(address, type); // Freighter signs on-chain consent
      setStep("issue");
      const r = await issueProfile(address, type);
      setResult(r);
      setStep("done");
    } catch (e) {
      setError(e.message);
      setStep("idle");
    }
  }

  const busy = step === "consent" || step === "issue";

  return (
    <section className="page">
      <p className="eyebrow">Prove without exposing</p>
      <h1 className="title">
        Turn your financial history
        <br />
        into a signed proof.
      </h1>
      <p className="lede">
        Approve a profile, and EMP anchors a cryptographic attestation on Stellar. Raw data never
        leaves the vault — the verifier receives only the sealed result.
      </p>

      <div className="panel" style={{ marginTop: 36 }}>
        {!address ? (
          <>
            <p className="ptype" style={{ fontSize: 20 }}>Connect your wallet to begin.</p>
            <p className="note">Your Stellar address is your economic identity. Consent is signed by your own key.</p>
            <div className="btn-row">
              <button className="btn gold" onClick={connect}>Connect Freighter</button>
            </div>
          </>
        ) : (
          <>
            <label className="field" htmlFor="ptype">Profile to issue</label>
            <select id="ptype" value={type} onChange={(e) => setType(e.target.value)} disabled={busy}>
              {TYPES.map(([v, l]) => (
                <option key={v} value={v}>{l} Profile</option>
              ))}
            </select>

            <div className="btn-row">
              <button className="btn" onClick={run} disabled={busy}>
                {step === "consent" && <><span className="spin">◴</span>&nbsp; Awaiting consent signature…</>}
                {step === "issue" && <><span className="spin">◴</span>&nbsp; Generating &amp; anchoring…</>}
                {(step === "idle" || step === "done") && "Approve & anchor"}
              </button>
            </div>
            <p className="note">
              Step 1 — sign consent in Freighter. Step 2 — EMP signs the profile and writes its hash to Stellar.
            </p>
            {error && <p className="err">✕ {error}</p>}
          </>
        )}
      </div>

      {result && (
        <div className="panel">
          <div className="credential">
            <Seal confidence={result.confidence} state="valid" label="sealed" />
            <div className="body">
              <h2 className="ptype">{type} profile</h2>
              <span className="pill valid">Anchored on Stellar</span>
              <ul className="reason">
                {result.reasoning.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
              <div className="hashline">attestation · {result.attestationId}</div>
              <div className="btn-row">
                <a className="btn ghost" href={`/verify?id=${result.attestationId}`}>Open in verifier →</a>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
