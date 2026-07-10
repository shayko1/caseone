import { useEffect, useMemo, useState } from "react";
import type { Design } from "../lib/wix";
import { optimizeImage } from "../lib/image";

interface StylesWallProps {
  designs: Design[];
  className?: string;
}

const TILE_COUNT = 10;
const SHUFFLE_INTERVAL_MS = 3200;

/**
 * Deterministic initial fill (first N distinct designs in order) — this
 * mounts client:only, so there's no SSR markup to match, but a stable
 * initial grid still avoids an initial-paint flash of repeats.
 */
function initialTiles(pool: Design[]): Design[] {
  if (pool.length === 0) return [];
  const count = Math.min(TILE_COUNT, pool.length);
  const tiles: Design[] = [];
  for (let i = 0; i < count; i++) {
    tiles.push(pool[i % pool.length]);
  }
  return tiles;
}

export default function StylesWall({ designs, className }: StylesWallProps) {
  const pool = useMemo(() => designs.filter((design) => Boolean(design.image)), [designs]);
  const [tiles, setTiles] = useState<Design[]>(() => initialTiles(pool));

  useEffect(() => {
    setTiles(initialTiles(pool));
  }, [pool]);

  useEffect(() => {
    if (pool.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const id = window.setInterval(() => {
      setTiles((current) => {
        if (current.length === 0) return current;
        const slot = Math.floor(Math.random() * current.length);
        const visibleIds = new Set(current.map((design) => design.id));
        const candidates = pool.filter((design) => !visibleIds.has(design.id));
        const next =
          candidates.length > 0
            ? candidates[Math.floor(Math.random() * candidates.length)]
            : pool[Math.floor(Math.random() * pool.length)];
        const updated = current.slice();
        updated[slot] = next;
        return updated;
      });
    }, SHUFFLE_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [pool]);

  if (pool.length === 0) {
    return (
      <div className={["styles-wall-empty", "glass", className].filter(Boolean).join(" ")}>
        <p>New styles are on the way — check back soon.</p>
      </div>
    );
  }

  return (
    <div className={["styles-wall", className].filter(Boolean).join(" ")}>
      {tiles.map((design, slot) => (
        <div className="styles-wall-tile" key={slot}>
          <img
            key={design.id}
            src={optimizeImage(design.image, { width: 400, quality: 70 })}
            alt={design.title || "AI-generated case design"}
            loading="lazy"
            decoding="async"
            width={200}
            height={400}
          />
        </div>
      ))}
    </div>
  );
}
