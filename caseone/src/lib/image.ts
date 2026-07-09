// Wix Media serves an uploaded asset's ORIGINAL bytes at
// `static.wixstatic.com/media/<fileId>~mv2.<ext>` — no resize or re-encode.
// The CMS-seeded `designs`/`gallery` collections (seed-artifacts/media-map.json)
// store exactly that raw URL, and every design asset in that pool is a small,
// AI-generated PNG (~178x350px, but 60-150KB — lossless PNG compresses noisy
// generated textures badly). Every consumer renders these at various on-screen
// sizes, several larger than the native pixels, so a server-side crop/resize
// (Wix's `/v1/fill/...`) would upscale and can end up LARGER than the
// original. `/v1/fit/...` (documented under wix.com/skills/headless media
// APIs) is the safe transform here: it only shrinks an image that's bigger
// than the given box and otherwise leaves native resolution alone, so this
// is effectively "re-encode as WebP, never upscale" — a straight ~55%+ size
// win from the format change alone, with zero upscale risk. Applied at
// render time only; the stored URL is untouched.
const WIXSTATIC_MEDIA_RE = /^https:\/\/static\.wixstatic\.com\/media\/([^/]+)$/;

/**
 * Re-encodes a static.wixstatic.com media URL to WebP without cropping or
 * upscaling. Non-wixstatic URLs (external, already-transformed, empty)
 * pass through unchanged.
 */
export function optimizeImage(url: string | null | undefined, quality = 85): string {
  if (!url) return "";
  const match = url.match(WIXSTATIC_MEDIA_RE);
  if (!match) return url;
  return `${url}/v1/fit/w_1600,h_1600,q_${quality}/img.webp`;
}
