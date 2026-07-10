import { useEffect, useState, type ComponentType } from "react";
import type { GenesisIntroProps } from "./GenesisIntro";

const SESSION_KEY = "caseone-intro-seen";

function shouldSkipIntro(): boolean {
  if (typeof window === "undefined") return true;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  if (window.matchMedia("(max-width: 768px)").matches) return true;
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
  try {
    if (sessionStorage.getItem(SESSION_KEY) === "1") return true;
  } catch {
    /* private mode */
  }
  try {
    const canvas = document.createElement("canvas");
    if (!(canvas.getContext("webgl2") || canvas.getContext("webgl"))) return true;
  } catch {
    return true;
  }
  return false;
}

/**
 * Tiny gate that decides whether to download the heavy GenesisIntro chunk
 * (three.js + gsap). Mobile / save-data / reduced-motion never pay that cost.
 */
export default function GenesisIntroGate(props: GenesisIntroProps) {
  const [Intro, setIntro] = useState<ComponentType<GenesisIntroProps> | null>(null);

  useEffect(() => {
    if (shouldSkipIntro()) {
      props.onComplete?.();
      return;
    }

    let cancelled = false;
    import("./GenesisIntro").then((mod) => {
      if (!cancelled) setIntro(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!Intro) return null;
  return <Intro {...props} />;
}
