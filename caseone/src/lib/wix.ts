// SSR-safe data-access layer over the CASEONE CMS collections (styles, designs,
// gallery). Managed-Astro auto-authenticates — no createClient/OAuthStrategy;
// `items` is called directly. Every exported function wraps its query in
// try/catch and returns a safe empty-array fallback, so a query failure at SSR
// can't crash the page mid-render.
import { items } from "@wix/data";

export interface Style {
  id: string;
  title: string;
  slug: string;
  description: string;
  coverImage: string;
  accentColor: string;
}

export interface Design {
  id: string;
  title: string;
  image: string;
  styleSlug: string;
  tags: string[];
}

export interface GalleryItem {
  id: string;
  title: string;
  image: string;
  creatorName: string;
  promptText: string;
  styleSlug: string;
}

// The "designs" collection stores tags as a single comma-separated TEXT field
// (see scripts/seed-cms.sh), not an array field — split it back out here.
function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

export async function getStyles(): Promise<Style[]> {
  try {
    const { items: results } = await items
      .query("styles")
      .ascending("title")
      .limit(50)
      .find();

    return results.map((item: any) => ({
      id: item._id,
      title: item.title ?? "",
      slug: item.slug ?? "",
      description: item.description ?? "",
      coverImage: item.coverImage ?? "",
      accentColor: item.accentColor ?? "",
    }));
  } catch (err) {
    console.error("[wix:styles] getStyles failed:", err);
    return [];
  }
}

export async function getDesigns(styleSlug?: string): Promise<Design[]> {
  try {
    let query = items.query("designs");
    if (styleSlug) {
      query = query.eq("styleSlug", styleSlug);
    }
    const { items: results } = await query.limit(100).find();

    return results.map((item: any) => ({
      id: item._id,
      title: item.title ?? "",
      image: item.image ?? "",
      styleSlug: item.styleSlug ?? "",
      tags: parseTags(item.tags),
    }));
  } catch (err) {
    console.error("[wix:designs] getDesigns failed:", err);
    return [];
  }
}

export async function getGallery(styleSlug?: string): Promise<GalleryItem[]> {
  try {
    let query = items.query("gallery").eq("approved", true);
    if (styleSlug) {
      query = query.eq("styleSlug", styleSlug);
    }
    const { items: results } = await query.limit(100).find();

    return results.map((item: any) => ({
      id: item._id,
      title: item.title ?? "",
      image: item.image ?? "",
      creatorName: item.creatorName ?? "",
      promptText: item.promptText ?? "",
      styleSlug: item.styleSlug ?? "",
    }));
  } catch (err) {
    console.error("[wix:gallery] getGallery failed:", err);
    return [];
  }
}
