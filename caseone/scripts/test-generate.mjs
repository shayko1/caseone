// Sanity-checks generateDesigns()'s determinism contract against a 48-item
// fixture (mirrors the live "designs" collection size). Run with
// `node scripts/test-generate.mjs` — importing generateDesigns.ts needs
// --experimental-strip-types, so this re-execs itself with that flag if it
// wasn't already passed.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!process.execArgv.includes("--experimental-strip-types") && !process.env.CASEONE_TEST_REEXEC) {
  execFileSync(
    process.execPath,
    ["--experimental-strip-types", fileURLToPath(import.meta.url)],
    { stdio: "inherit", env: { ...process.env, CASEONE_TEST_REEXEC: "1" } },
  );
  process.exit(0);
}

const { hashSeed, generateDesigns } = await import("../src/lib/generateDesigns.ts");

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

function sameOrder(a, b) {
  return a.length === b.length && a.every((item, i) => item.id === b[i].id);
}

// --- 48-item fixture across 12 styles, 4 designs each (mirrors seed-cms.sh shape) ---
const STYLE_SLUGS = [
  "cyberpunk", "minimal-luxury", "anime", "streetwear",
  "marble", "floral", "abstract", "graffiti",
  "vintage", "y2k", "futuristic", "photo-collage",
];
const pool = [];
for (const styleSlug of STYLE_SLUGS) {
  for (let n = 1; n <= 4; n++) {
    pool.push({
      id: `${styleSlug}-${String(n).padStart(2, "0")}`,
      title: `${styleSlug} ${n}`,
      image: `https://example.com/${styleSlug}-${n}.jpg`,
      styleSlug,
      tags: [styleSlug, `tag-${n}`],
    });
  }
}
assert(pool.length === 48, `fixture pool should have 48 items, got ${pool.length}`);

// 1. Same inputs twice -> identical id sequence.
const runA = generateDesigns("a sleek marble case", null, pool);
const runB = generateDesigns("a sleek marble case", null, pool);
assert(sameOrder(runA, runB), "same inputs must produce identical id sequence");

// 2. Different prompt -> different sequence.
const runC = generateDesigns("a neon cyberpunk case", null, pool);
assert(!sameOrder(runA, runC), "different prompts must produce different sequences");

// 3. Style filter respected — every result matches the requested style.
const filtered = generateDesigns("something floral", "floral", pool, 4);
assert(
  filtered.every((item) => item.styleSlug === "floral"),
  "style filter must restrict results to the requested styleSlug",
);
assert(filtered.length === 4, `style filter run should return 4 items, got ${filtered.length}`);

// 4. Default count is 4.
const defaultCount = generateDesigns("default count check", null, pool);
assert(defaultCount.length === 4, `default count should be 4, got ${defaultCount.length}`);

// 5. Explicit count is respected.
const explicitCount = generateDesigns("explicit count check", null, pool, 7);
assert(explicitCount.length === 7, `explicit count should be 7, got ${explicitCount.length}`);

// 6. hashSeed is a deterministic 32-bit unsigned integer.
const h1 = hashSeed("same|input");
const h2 = hashSeed("same|input");
assert(h1 === h2, "hashSeed must be deterministic for identical input");
assert(Number.isInteger(h1) && h1 >= 0 && h1 <= 0xffffffff, "hashSeed must return a uint32");
assert(hashSeed("different|input") !== h1, "hashSeed must differ for different input");

console.log("ok");
