"use client";

/**
 * The Proof Seal — the product's signature element.
 *
 * Confidence is drawn as a swept arc, so its magnitude is read before any digit
 * is. The ring is hairline-thin to echo the landing page's borders; the figure
 * is set in Instrument Serif, the same face as the landing display type.
 *
 * States:
 *   valid   — plum arc, solid ring
 *   revoked — rust arc, broken into dashes, because a revoked proof is not
 *             "low confidence", it is withdrawn
 *   pending — nothing to report yet
 */
export default function Seal({ confidence = 0, state = "valid", label, size = 168 }) {
  const stroke = 3;
  const r = (size - stroke * 2) / 2 - 10;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, confidence));
  const offset = circ * (1 - pct);

  const arcColor =
    state === "revoked"
      ? "var(--color-rust)"
      : state === "pending"
        ? "var(--color-plum-mist)"
        : "var(--color-plum)";

  return (
    <div className="flex flex-col items-center gap-3 shrink-0">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            className="text-black/10"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={arcColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            className="seal-arc"
            style={{ "--seal-circ": circ, "--seal-offset": offset }}
            strokeDasharray={state === "revoked" ? "2 7" : undefined}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {state === "pending" ? (
            <span className="font-serif text-3xl text-black/25">—</span>
          ) : (
            <>
              <span
                className="font-serif leading-none text-black"
                style={{ fontSize: size * 0.3, letterSpacing: "-0.03em" }}
              >
                {Math.round(pct * 100)}
                <span className="text-black/40" style={{ fontSize: size * 0.15 }}>
                  %
                </span>
              </span>
              <span className="font-barlow text-[10px] font-semibold uppercase tracking-[0.18em] text-black/40 mt-1">
                confidence
              </span>
            </>
          )}
        </div>
      </div>

      {label && (
        <span
          className={`font-barlow text-[10px] font-semibold uppercase tracking-[0.2em] px-3 py-1 rounded-full ${
            state === "revoked"
              ? "bg-[#b4483c]/10 text-[#b4483c]"
              : "bg-[#2b2644]/8 text-[#2b2644]"
          }`}
        >
          {label}
        </span>
      )}
    </div>
  );
}

/**
 * Category band — money flow by AI-assigned category as one continuous bar.
 * Replaces a table of figures: proportion is read first, and the largest
 * outflow is obvious without parsing a single number.
 */
/* Inflows walk the plum family; outflows walk a warm stone ramp. The two
   families are far enough apart that "money in" and "money out" separate
   without a legend, and each ramp keeps enough contrast between steps to tell
   its own categories apart. */
const INFLOW_SHADES = ["#2b2644", "#514a7d", "#7d74b8"];
const OUTFLOW_SHADES = ["#9c8f80", "#b6ab9d", "#cec5ba", "#e0dad2"];

export function CategoryBand({ byCategory = {} }) {
  const entries = Object.entries(byCategory)
    .map(([name, v]) => ({ name, value: Math.abs(v), inflow: v >= 0 }))
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value);

  const total = entries.reduce((a, e) => a + e.value, 0);
  if (!total) return null;

  let iIn = 0;
  let iOut = 0;
  const shaded = entries.map((e) => ({
    ...e,
    color: e.inflow
      ? INFLOW_SHADES[iIn++ % INFLOW_SHADES.length]
      : OUTFLOW_SHADES[iOut++ % OUTFLOW_SHADES.length],
  }));

  return (
    <div className="w-full">
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        {shaded.map((e, idx) => (
          <div
            key={e.name}
            className="band-seg h-full"
            title={`${e.name}: ${e.value.toLocaleString()}`}
            style={{
              width: `${(e.value / total) * 100}%`,
              background: e.color,
              animationDelay: `${idx * 55}ms`,
            }}
          />
        ))}
      </div>

      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2.5">
        {shaded.map((e) => (
          <div key={e.name} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: e.color }} />
            <span className="font-barlow text-[11px] font-semibold uppercase tracking-[0.1em] text-black/70">
              {e.name}
            </span>
            <span className="font-sans text-[11px] font-light text-black/40">
              {e.inflow ? "+" : "−"}
              {e.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Check row — a verification step drawn as a bar that fills when it passes.
 * A failed check leaves the bar visibly short, so a broken proof looks broken
 * before the word "fail" is read.
 */
export function CheckBar({ ok, label, delay = 0 }) {
  return (
    <div className="py-3.5 border-b border-black/5 last:border-0">
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <span className="font-sans text-sm font-light text-black/75">{label}</span>
        <span
          className={`font-barlow text-[10px] font-semibold uppercase tracking-[0.18em] ${
            ok ? "text-[#2b2644]" : "text-[#b4483c]"
          }`}
        >
          {ok ? "pass" : "fail"}
        </span>
      </div>
      <div className="h-[3px] w-full rounded-full bg-black/6 overflow-hidden">
        <div
          className="band-seg h-full rounded-full"
          style={{
            width: ok ? "100%" : "22%",
            background: ok ? "#2b2644" : "#b4483c",
            animationDelay: `${delay}ms`,
          }}
        />
      </div>
    </div>
  );
}

/** A single figure with a Barlow caption. Used sparingly — graphics lead. */
export function Stat({ value, label, tone = "ink" }) {
  return (
    <div>
      <div
        className="font-serif leading-none text-3xl md:text-4xl"
        style={{ letterSpacing: "-0.03em", color: tone === "plum" ? "#2b2644" : "#000" }}
      >
        {value}
      </div>
      <div className="font-barlow text-[10px] font-semibold uppercase tracking-[0.18em] text-black/40 mt-2">
        {label}
      </div>
    </div>
  );
}
