"use client";

/**
 * The signature element: a stamped verification seal.
 * state: "pending" | "valid" | "revoked". The ring fills to `confidence`.
 */
export default function Seal({ confidence = 0, state = "pending", label }) {
  const R = 58;
  const C = 2 * Math.PI * R;
  const pct = Math.max(0, Math.min(1, confidence));
  const dash = C * pct;
  const color = state === "valid" ? "#2fa36b" : state === "revoked" ? "#c0483a" : "#5b6472";

  return (
    <div className={`seal ${state}`}>
      <svg viewBox="0 0 132 132">
        <circle cx="66" cy="66" r={R} fill="none" stroke="rgba(11,14,20,0.12)" strokeWidth="6" />
        <circle
          cx="66"
          cy="66"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${C}`}
        />
        {/* notched outer ring — the "stamp" motif */}
        <circle cx="66" cy="66" r="64" fill="none" stroke={color} strokeWidth="1" strokeDasharray="2 4" opacity="0.5" />
      </svg>
      <div className="core">
        <span className="pct">{Math.round(pct * 100)}%</span>
        <span className="cap">{label || state}</span>
      </div>
    </div>
  );
}
