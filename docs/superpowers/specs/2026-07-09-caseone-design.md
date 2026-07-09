# CASEONE — AI-Powered Custom iPhone Case Site — Design Spec

**Date:** 2026-07-09
**Status:** Approved by user
**Stack:** Wix Headless (managed create) — Astro frontend scaffolded via `@wix/cli`, Wix-hosted
**Design references:** serverobotics.com (typography, section rhythm), faunarobotics.com (palette, segmented blocks)

## 1. Concept

A premium, tech-fashion web experience where users "design" one-of-a-kind iPhone cases with an AI studio, preview them on an interactive 3D phone, personalize, and buy. Tone: premium, creative, emotional, futuristic, confident.

**Brand:** CASEONE — "the only case in the world." Spaced-letter wordmark.

**Key decision — simulated AI:** The studio UI is fully real (prompt input, style picker, inspiration upload, staged loading), but generation deterministically selects from a seeded CMS library of pre-generated design images. All selection logic lives in a single `generateDesigns(prompt, styleId)` module so a real image-generation API can replace it later without UI changes. Deterministic (same prompt + style → same results) — idempotent and shareable.

## 2. Architecture

- **Backend (Wix apps):**
  - **Stores** (+ eCommerce dependency) — product, variants, cart, guest checkout.
  - **CMS** — three collections: `styles`, `designs`, `gallery` (see §5).
  - **Forms** — enterprise/developer inquiry form.
  - No members, bookings, blog, events — guest checkout keeps the flow frictionless.
- **Frontend (Astro):** static-first pages; interactive islands (studio, 3D preview, cart badge) hydrate client-side using `@wix/sdk` with the headless OAuth client ID.
- **Deployment:** built and released to Wix per the managed create flow.

## 3. Pages & navigation

Minimal sticky nav: **Studio · Gallery · Shop · About** + coral CTA button **"Design Yours"** + cart icon with live count.

| Page | Content |
|---|---|
| `/` | Hero: auto-rotating 3D phone cycling seeded designs; multi-line spaced-letter tagline ("Design the only iPhone case in the world that looks exactly like you"); stat blocks — "From idea to case in 60 seconds", "No templates. No duplicates.", "Spin it before you buy it"; live-shuffling AI styles wall (from CMS); Fauna-style segmented blocks (creators / enterprises / developers) with inquiry-form links; footer |
| `/studio` | Full flow: (1) pick iPhone model → (2) prompt + style chips + optional inspiration upload (client-side; influences selection seed) → (3) generate 4 concepts with staged loading → (4) interactive 3D preview → (5) finish (matte / glossy / leather) → (6) personalization (initials, name, date) → (7) add to cart |
| `/gallery` | Community wall from `gallery` collection (approved only), style filters, "Remix this" deep-links into studio |
| `/product` | Materials, protection level, MagSafe support, shipping, pricing, FAQ |
| `/about` | Brand story |
| `/cart` | Wix eCommerce cart → hosted checkout redirect; line items carry design thumbnail + personalization |

## 4. 3D preview

three.js island. Stylized iPhone from rounded-box primitives + camera-module geometry (no external GLTF — license-safe, small bundle). Selected design image applied as the case texture.

- Interactions: drag-to-rotate, scroll/pinch zoom, lighting presets (studio / warm / neon), device-color swatches.
- Homepage hero: auto-rotate. Studio: fully interactive.
- Fallback: no WebGL → flat design image with CSS tilt.
- Accessibility: keyboard rotation buttons + ARIA labels on the canvas region.

## 5. Data model (Wix CMS)

- **`styles`** — name, slug, description, cover image, accent color. Seed ~12: cyberpunk, minimal luxury, anime, streetwear, marble, floral, abstract, graffiti, vintage, Y2K, futuristic, photo collage.
- **`designs`** — image, title, styleRef, tags, palette. Seed 48–60 (4–5 per style). Images AI-generated during the skill's imagery step.
- **`gallery`** — designRef or image, creator name, prompt text, styleRef, **`approved` boolean (moderation gate)**. Site queries `approved == true` only; studio "share to gallery" submits unapproved rows.

## 6. Commerce

One product: **"CASEONE Custom Case" — $59** (leather +$20).
Variants: iPhone model (15 / 15 Pro / 16 / 16 Pro / 16 Pro Max) × finish (matte / glossy / leather).
Add-to-cart attaches line-item custom fields: design image URL, design title, personalization text — so orders record exactly what was designed. Guest checkout via Wix-hosted checkout redirect.

## 7. Visual design system

- **Canvas:** off-white `#FAF8F5`, soft radial pastel gradients (blush / teal wash), generous whitespace.
- **Type:** bold geometric sans-serif; hero headlines broken across 3–4 lines with wide letter-spacing; all-caps eyebrow labels; oversized numerals for stats.
- **Accents:** coral-red `#FF5A47` (primary CTA), teal `#1FB6A6` (secondary/highlights). AA contrast verified against canvas.
- **Surfaces:** 24px rounded corners; glassmorphism panels (backdrop blur + translucent white) for studio controls; soft-edged imagery.
- **Motion:** scroll-triggered fades + parallax on section entry; animated concentric-ring motif behind hero phone; ring loader during generation. All motion honors `prefers-reduced-motion`.

## 8. Resilience & quality

- Skeleton/loading states on every CMS/Stores fetch; friendly retry on failure; empty states for gallery filters.
- Deterministic generation module — idempotent, no server state.
- Accessibility: semantic landmarks, labeled controls, keyboard-operable studio and 3D viewer, AA contrast.
- SEO: per-page titles/descriptions/OG images; product structured data.
- Verification: `wix build` as correctness gate; single post-release smoke check per the skill's deployment step. No local dev-server test loops (per skill policy).

## 9. Explicit non-goals (this phase)

- Real AI image generation (seam prepared in `generateDesigns`).
- Member accounts / login.
- Product-per-design catalog entries.
- Admin moderation UI (moderation happens via the Wix CMS dashboard `approved` flag).
