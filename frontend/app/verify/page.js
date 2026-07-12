"use client";
import { useState, useEffect, Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { verify } from "../../lib/emp";
import Seal, { CheckBar } from "../seal";
import { Shell, Card, Eyebrow, Title, Lede, FlatButton, ErrorNote } from "../ui";

function VerifyInner() {
  const params = useSearchParams();
  const [id, setId] = useState("");
  const [res, setRes] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const run = useCallback(
    async (target) => {
      const attId = (target ?? id).trim();
      if (!attId) return;
      setError("");
      setRes(null);
      setLoading(true);
      try {
        setRes(await verify(attId));
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    const q = params.get("id");
    if (q) {
      setId(q);
      run(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const state = res ? (res.valid ? "valid" : "revoked") : "pending";

  return (
    <Shell>
      <div className="max-w-3xl mb-14">
        <Eyebrow>Verifier</Eyebrow>
        <Title>
          Does the proof <span className="italic font-light text-black/80">hold</span>?
        </Title>
        <div className="mt-5">
          <Lede>
            Paste an attestation. PersonaOS re-runs every check: the issuer&rsquo;s signature, the hash written to
            Stellar, and whether it has since been withdrawn. You see the verdict, never the data.
          </Lede>
        </div>
      </div>

      <Card className="p-8 max-w-3xl mb-4">
        <label
          htmlFor="att"
          className="block font-barlow text-[10px] font-semibold uppercase tracking-[0.18em] text-black/40 mb-3"
        >
          Attestation id
        </label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            id="att"
            value={id}
            placeholder="b35cb311f3119856…"
            onChange={(e) => setId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            className="flex-1 min-w-0 rounded-full border border-black/12 bg-white px-6 py-3 font-mono text-sm text-black placeholder:text-black/25 focus:border-[#2b2644] focus:outline-none transition-colors"
          />
          <FlatButton tone="ink" onClick={() => run()} disabled={loading || !id.trim()}>
            {loading ? "Checking" : "Check proof"}
          </FlatButton>
        </div>
        <ErrorNote>{error}</ErrorNote>
      </Card>

      {res && (
        <Card className="p-10 max-w-3xl rise">
          <div className="flex flex-col md:flex-row gap-10 items-start">
            <Seal
              confidence={res.profile.confidence}
              state={state}
              label={res.valid ? "verified" : "withdrawn"}
            />

            <div className="flex-1 min-w-0">
              <Eyebrow>{res.profile.profileType} profile</Eyebrow>
              <h2 className="font-serif text-4xl text-black mb-8" style={{ letterSpacing: "-0.03em" }}>
                {res.valid ? (
                  <>
                    This proof <span className="italic font-light">holds</span>.
                  </>
                ) : (
                  <>
                    This proof <span className="italic font-light text-[#b4483c]">no longer holds</span>.
                  </>
                )}
              </h2>

              <div className="mb-9">
                <CheckBar ok={res.checks.signature} label="Issued by PersonaOS (Ed25519 signature)" delay={120} />
                <CheckBar
                  ok={res.checks.onChainHashMatch}
                  label="Matches the hash on Stellar, and still stands"
                  delay={220}
                />
              </div>

              {res.profile.reasoning?.length > 0 && (
                <>
                  <p className="font-barlow text-[10px] font-semibold uppercase tracking-[0.18em] text-black/40 mb-4">
                    What the Twin concluded
                  </p>
                  <ul className="flex flex-col gap-3.5 mb-9">
                    {res.profile.reasoning.map((r, i) => (
                      <li key={i} className="flex gap-4">
                        <span
                          className={`mt-2 h-1 w-1 rounded-full shrink-0 ${
                            res.valid ? "bg-[#2b2644]" : "bg-black/20"
                          }`}
                        />
                        <span
                          className={`font-sans font-light text-sm leading-relaxed ${
                            res.valid ? "text-black/70" : "text-black/40"
                          }`}
                        >
                          {r}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <div className="rounded-xl bg-[#F5F5F5] border border-black/5 px-5 py-4">
                <p className="font-barlow text-[10px] font-semibold uppercase tracking-[0.18em] text-black/40 mb-1.5">
                  Issuer
                </p>
                <p className="font-mono text-xs text-black/60 break-all">{res.issuerPub}</p>
              </div>
            </div>
          </div>
        </Card>
      )}
    </Shell>
  );
}

export default function Verify() {
  return (
    <Suspense
      fallback={
        <Shell>
          <Lede>Loading…</Lede>
        </Shell>
      }
    >
      <VerifyInner />
    </Suspense>
  );
}
