import { useEffect, useState } from "react";
import CasePreview from "./CasePreview";

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

export default function HeroCasePreview({ designUrls, className }: HeroCasePreviewProps) {
  const [index, setIndex] = useState(0);

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
