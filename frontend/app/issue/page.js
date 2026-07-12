"use client";
import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet } from "../wallet";
import { grantConsent, issueProfile } from "../../lib/emp";
import Seal from "../seal";
import { Shell, Card, Eyebrow, Title, Lede, PillButton, ErrorNote, ConnectGate } from "../ui";

const TYPES = [
  { id: "loan", label: "Loan", blurb: "Income stability, debt ratio, repayment discipline." },
  { id: "hiring", label: "Hiring", blurb: "Verified work history and contribution record." },
  { id: "freelancer", label: "Freelancer", blurb: "Client repeat rate and delivery consistency." },
  { id: "insurance", label: "Insurance", blurb: "Financial resilience and risk behaviour." },
];

const STEPS = {
  consent: "Sign the consent in Freighter",
  issue: "Your Twin is reasoning, then anchoring",
};

function IssueInner() {
  const params = useSearchParams();
  const { address } = useWallet();
  const [type, setType] = useState(() => {
    const q = params.get("type");
    return TYPES.some((t) => t.id === q) ? q : "loan";
  });
  const [step, setStep] = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function run() {
    setError("");
    setResult(null);
    try {
      setStep("consent");
      await grantConsent(address, type);
      setStep("issue");
      setResult(await issueProfile(address, type));
      setStep("done");
    } catch (e) {
      setError(e.message);
      setStep("idle");
    }
  }

  const busy = step === "consent" || step === "issue";
  const active = TYPES.find((t) => t.id === type);

  return (
    <Shell>
      <div className="max-w-3xl mb-14">
        <Eyebrow>Prove without exposing</Eyebrow>
        <Title>
          Turn memory into a <span className="italic font-light text-black/80">proof</span>.
        </Title>
        <div className="mt-5">
          <Lede>
            Choose what you need to prove. Your Twin reads its own memory, reaches a conclusion, signs it, and writes
            the hash to Stellar. The verifier receives the conclusion — never the data behind it.
          </Lede>
        </div>
      </div>

      <ConnectGate line="Consent is signed by your own key. Nothing can be issued about you without it." />

      {address && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* choose */}
          <div className="lg:col-span-2">
            <Card className="p-8">
              <p className="font-barlow text-[10px] font-semibold uppercase tracking-[0.18em] text-black/40 mb-5">
                What to prove
              </p>
              <div className="flex flex-col gap-2.5">
                {TYPES.map((t) => {
                  const on = t.id === type;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setType(t.id)}
                      disabled={busy}
                      aria-pressed={on}
                      className={`w-full text-left px-5 py-4 rounded-xl border transition-all duration-200 cursor-pointer disabled:cursor-not-allowed ${
                        on
                          ? "bg-black text-white border-black"
                          : "bg-white/50 border-black/10 hover:border-black/30 hover:bg-white"
                      }`}
                    >
                      <div className="font-barlow font-semibold">{t.label}</div>
                      <div className={`font-sans font-light text-xs mt-1 ${on ? "text-white/60" : "text-black/45"}`}>
                        {t.blurb}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-8 pt-7 border-t border-black/5">
                <PillButton onClick={run} busy={busy}>
                  {busy ? "Working" : `Issue ${active.label.toLowerCase()} proof`}
                </PillButton>
                <p className="font-sans font-light text-xs text-black/40 mt-5 leading-relaxed">
                  {busy ? STEPS[step] : "Two signatures: your consent, then the issuer's seal."}
                </p>
                <ErrorNote>{error}</ErrorNote>
              </div>
            </Card>
          </div>

          {/* result */}
          <div className="lg:col-span-3">
            {result ? (
              <Card className="p-10 rise">
                <div className="flex flex-col md:flex-row gap-10 items-start">
                  <Seal confidence={result.confidence} state="valid" label="anchored" />

                  <div className="flex-1 min-w-0">
                    <Eyebrow>{type} profile</Eyebrow>
                    <h2 className="font-serif text-4xl text-black mb-7" style={{ letterSpacing: "-0.03em" }}>
                      Your proof is <span className="italic font-light">live</span>.
                    </h2>

                    <p className="font-barlow text-[10px] font-semibold uppercase tracking-[0.18em] text-black/40 mb-4">
                      Why your Twin concluded this
                    </p>
                    <ul className="flex flex-col gap-3.5 mb-9">
                      {result.reasoning.map((r, i) => (
                        <li key={i} className="flex gap-4 rise" style={{ animationDelay: `${180 + i * 90}ms` }}>
                          <span className="mt-2 h-1 w-1 rounded-full bg-[#2b2644] shrink-0" />
                          <span className="font-sans font-light text-sm text-black/70 leading-relaxed">{r}</span>
                        </li>
                      ))}
                    </ul>

                    <div className="rounded-xl bg-[#F5F5F5] border border-black/5 px-5 py-4 mb-8">
                      <p className="font-barlow text-[10px] font-semibold uppercase tracking-[0.18em] text-black/40 mb-1.5">
                        Attestation
                      </p>
                      <p className="font-mono text-xs text-black/60 break-all leading-relaxed">
                        {result.attestationId}
                      </p>
                    </div>

                    <PillButton href={`/verify?id=${result.attestationId}`} tone="plum">
                      Open in verifier
                    </PillButton>
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="p-10 h-full min-h-[420px] flex flex-col justify-center items-center text-center">
                <Seal confidence={0} state="pending" size={144} />
                <p className="font-sans font-light text-sm text-black/45 mt-8 max-w-xs leading-relaxed">
                  {busy
                    ? STEPS[step]
                    : "Your seal appears here once the proof is signed and written to Stellar."}
                </p>
              </Card>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}

export default function Issue() {
  return (
    <Suspense
      fallback={
        <Shell>
          <Lede>Loading…</Lede>
        </Shell>
      }
    >
      <IssueInner />
    </Suspense>
  );
}
