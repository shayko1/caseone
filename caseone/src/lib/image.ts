// Wix Media serves an uploaded asset's ORIGINAL bytes at
// `static.wixstatic.com/media/<fileId>~mv2.<ext>` — no resize or re-encode.
// The CMS-seeded `designs`/`gallery` collections (seed-artifacts/media-map.json)
// store exactly that raw URL, and every design asset in that pool is a small,
// AI-generated PNG (~178x350px, but 60-150KB — lossless PNG compresses noisy
// generated textures badly). `/v1/fit/...` only shrinks when larger than the
// box and otherwise leaves native resolution alone, so this is effectively
// "re-encode as WebP, never upscale". Applied at render time only; the stored
// URL is untouched.
const WIXSTATIC_MEDIA_RE = /^https:\/\/static\.wixstatic\.com\/media\/([^/]+)$/;

export type OptimizeImageOptions = {
  /** Max width for the fit box. Defaults to 800 (enough for hero/3D textures). */
  width?: number;
  /** Max height for the fit box. Defaults to 2× width (phone-case aspect). */
  height?: number;
  /** WebP quality 1–100. Defaults to 72. */
  quality?: number;
};

/**
 * Re-encodes a static.wixstatic.com media URL to WebP without cropping or
 * upscaling. Non-wixstatic URLs (external, already-transformed, empty)
 * pass through unchanged.
 *
 * Second arg accepts a quality number (legacy) or an options object.
 */
export function optimizeImage(
  url: string | null | undefined,
  qualityOrOptions: number | OptimizeImageOptions = 72
): string {
  if (!url) return "";
  const match = url.match(WIXSTATIC_MEDIA_RE);
  if (!match) return url;

  const opts: OptimizeImageOptions =
    typeof qualityOrOptions === "number"
      ? { quality: qualityOrOptions }
      : qualityOrOptions;

  const width = opts.width ?? 800;
  const height = opts.height ?? Math.round(width * 2);
  const quality = opts.quality ?? 72;

  return `${url}/v1/fit/w_${width},h_${height},q_${quality}/img.webp`;
}
