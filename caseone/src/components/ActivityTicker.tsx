import { useEffect, useState } from "react";

interface ActivityTickerProps {
  lines: string[];
  className?: string;
}

// Ambient only — no countdowns, no urgency framing. Lines are fully composed
// server-side (real gallery creator + a city + their design's style); this
// component just owns the client-side rotation timer.
const ROTATE_INTERVAL_MS = 5000;

export default function ActivityTicker({ lines, className }: ActivityTickerProps) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (lines.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % lines.length);
    }, ROTATE_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [lines.length]);

  const activeLine = lines[index];
  if (!activeLine) return null;

  return (
    <p className={["activity-ticker", className].filter(Boolean).join(" ")}>
      <span className="activity-ticker-dot" aria-hidden="true" />
      <span key={activeLine} className="activity-ticker-text">
        {activeLine}
      </span>
    </p>
  );
}
