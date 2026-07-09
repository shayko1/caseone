import { useRef } from "react";
import type { Design } from "../lib/wix";
import { optimizeImage } from "../lib/image";

interface TrendingCarouselProps {
  designs: Design[];
  styleTitleBySlug: Record<string, string>;
}

export default function TrendingCarousel({ designs, styleTitleBySlug }: TrendingCarouselProps) {
  const trackRef = useRef<HTMLUListElement | null>(null);

  const scroll = (direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    const amount = Math.max(track.clientWidth * 0.8, 240) * direction;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollBy({ left: amount, behavior: reducedMotion ? "auto" : "smooth" });
  };

  if (designs.length === 0) {
    return (
      <div className="trending-empty glass">
        <p>Trending designs are on their way.</p>
      </div>
    );
  }

  return (
    <div className="trending-carousel-wrap">
      <button
        type="button"
        className="trending-arrow trending-arrow--prev"
        aria-label="Scroll trending designs left"
        onClick={() => scroll(-1)}
      >
        ‹
      </button>
      <ul className="trending-track" ref={trackRef} tabIndex={0} aria-label="Trending designs, scrollable">
        {designs.map((design) => (
          <li className="trending-tile" key={design.id}>
            <div className="trending-tile-frame">
              <img
                src={optimizeImage(design.image)}
                alt={design.title || "Case design"}
                loading="lazy"
              />
            </div>
            <div className="trending-tile-body">
              <span className="trending-chip">
                {styleTitleBySlug[design.styleSlug] ?? design.styleSlug}
              </span>
              <p className="trending-price">$59</p>
              <a
                className="btn-ghost trending-cta"
                href={`/studio?style=${encodeURIComponent(design.styleSlug)}`}
              >
                Make it yours
              </a>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="trending-arrow trending-arrow--next"
        aria-label="Scroll trending designs right"
        onClick={() => scroll(1)}
      >
        ›
      </button>
    </div>
  );
}
