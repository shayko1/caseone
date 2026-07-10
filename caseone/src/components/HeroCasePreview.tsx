import { useEffect, useState, type ComponentType } from "react";
import { optimizeImage } from "../lib/image";
import type { CasePreviewProps } from "./CasePreview";

interface HeroCasePreviewProps {
  designUrls: string[];
  className?: string;
}

// CasePreview's designUrl prop can change after mount, but Astro props are
// static once SSR'd — this wrapper owns the client-side timer and re-renders
// CasePreview with a new designUrl on each tick.
//
// CasePreview drops a designUrl swap that lands inside the first ~1.5s of
// mount (mid initial async scene build), so the first rotation is delayed a
// full interval rather than firing early.
const ROTATE_INTERVAL_MS = 4500;

function prefersLiteHero(): boolean {
  if (typeof window === "undefined") return true;
  if (window.matchMedia("(max-width: 768px)").matches) return true;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  try {
    const conn = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    if (conn?.saveData) return true;
    if (conn?.effectiveType === "slow-2g" || conn?.effectiveType === "2g") return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** Lightweight rotating image — avoids loading the 700KB+ three.js chunk on mobile. */
function LiteHeroCarousel({
  designUrls,
  className,
  index,
}: {
  designUrls: string[];
  className?: string;
  index: number;
}) {
  const activeUrl = designUrls[index] ?? designUrls[0];
  if (!activeUrl) return null;

  return (
    <div
      className={["hero-lite-preview", className].filter(Boolean).join(" ")}
      role="img"
      aria-label="Phone case design preview"
      style={{
        perspective: "800px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
      }}
    >
      <img
        src={optimizeImage(activeUrl, { width: 640, quality: 75 })}
        alt="Phone case design preview"
        width={320}
        height={640}
        decoding="async"
        {...{ fetchpriority: "high" }}
        style={{
          width: "min(70%, 280px)",
          height: "auto",
          borderRadius: "22px",
          boxShadow: "0 24px 48px rgba(0,0,0,0.4)",
          transform: "rotateY(-16deg) rotateX(5deg)",
          transformStyle: "preserve-3d",
        }}
      />
    </div>
  );
}

export default function HeroCasePreview({ designUrls, className }: HeroCasePreviewProps) {
  const [index, setIndex] = useState(0);
  // null = undecided; true = lite (no three.js); false = full 3D desktop hero.
  const [lite, setLite] = useState<boolean | null>(null);
  const [CasePreview, setCasePreview] = useState<ComponentType<CasePreviewProps> | null>(null);

  useEffect(() => {
    const useLite = prefersLiteHero();
    setLite(useLite);
    if (useLite) return;

    let cancelled = false;
    import("./CasePreview").then((mod) => {
      if (!cancelled) setCasePreview(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (designUrls.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % designUrls.length);
    }, ROTATE_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [designUrls.length]);

  const activeUrl = designUrls[index] ?? designUrls[0];
  if (!activeUrl) return null;

  // Lite path (mobile / save-data / reduced-motion) — never touch three.js.
  if (lite !== false) {
    return <LiteHeroCarousel designUrls={designUrls} className={className} index={index} />;
  }

  if (!CasePreview) {
    return <LiteHeroCarousel designUrls={designUrls} className={className} index={index} />;
  }

  return (
    <CasePreview
      designUrl={activeUrl}
      deviceColor="#1c1c1e"
      lighting="studio"
      autoRotate
      interactive={false}
      separateCaseOnHover
      className={className}
    />
  );
}
