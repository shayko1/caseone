// POST /api/gallery-submit — accepts a community design submission and writes
// it into the "gallery" CMS collection with approved:false. Nothing here is
// ever surfaced to the public gallery until a moderator flips that flag in
// the dashboard (see src/lib/wix.ts#getGallery, which only reads approved:true).
import type { APIRoute } from "astro";
import { auth } from "@wix/essentials";
import { items } from "@wix/data";

const GALLERY_COLLECTION_ID = "gallery";

const TITLE_MAX_LENGTH = 60;
const CREATOR_NAME_MAX_LENGTH = 60;
const PROMPT_TEXT_MAX_LENGTH = 300;
const WIX_STATIC_IMAGE_PREFIX = "https://static.wixstatic.com/";

// The 12 style slugs seeded into the "styles" collection (Task 4). Kept as a
// literal allowlist so a submission can never write an arbitrary styleSlug.
const VALID_STYLE_SLUGS = new Set([
  "cyberpunk",
  "minimal-luxury",
  "anime",
  "streetwear",
  "marble",
  "floral",
  "abstract",
  "graffiti",
  "vintage",
  "y2k",
  "futuristic",
  "photo-collage",
]);

interface GallerySubmission {
  title: string;
  image: string;
  creatorName: string;
  promptText: string;
  styleSlug: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

function validateSubmission(body: unknown): { data: GallerySubmission } | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "Request body must be a JSON object." };
  }

  const { title, image, creatorName, promptText, styleSlug } = body as Record<string, unknown>;

  if (!isNonEmptyString(title, TITLE_MAX_LENGTH)) {
    return { error: `"title" is required and must be at most ${TITLE_MAX_LENGTH} characters.` };
  }
  if (!isNonEmptyString(creatorName, CREATOR_NAME_MAX_LENGTH)) {
    return { error: `"creatorName" is required and must be at most ${CREATOR_NAME_MAX_LENGTH} characters.` };
  }
  if (!isNonEmptyString(promptText, PROMPT_TEXT_MAX_LENGTH)) {
    return { error: `"promptText" is required and must be at most ${PROMPT_TEXT_MAX_LENGTH} characters.` };
  }
  if (typeof image !== "string" || !image.startsWith(WIX_STATIC_IMAGE_PREFIX)) {
    return { error: '"image" must be a Wix-hosted image URL.' };
  }
  if (typeof styleSlug !== "string" || !VALID_STYLE_SLUGS.has(styleSlug)) {
    return { error: '"styleSlug" must be one of the supported design styles.' };
  }

  return {
    data: {
      title: title.trim(),
      image,
      creatorName: creatorName.trim(),
      promptText: promptText.trim(),
      styleSlug,
    },
  };
}

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "Request body must be valid JSON." });
  }

  const result = validateSubmission(body);
  if ("error" in result) {
    return jsonResponse(400, { error: result.error });
  }

  try {
    const elevatedInsert = auth.elevate(items.insert);
    await elevatedInsert(GALLERY_COLLECTION_ID, {
      ...result.data,
      approved: false,
    });

    return jsonResponse(202, {
      message: "Sent for review — designs appear once approved.",
    });
  } catch (err) {
    console.error("[api:gallery-submit] insert failed:", err);
    return jsonResponse(500, {
      error: "Something went wrong submitting your design. Please try again later.",
    });
  }
};
