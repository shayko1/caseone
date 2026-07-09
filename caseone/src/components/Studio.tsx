import { useEffect, useRef, useState } from "react";
import { currentCart } from "@wix/ecom";
import CasePreview from "./CasePreview";
import type { LightingPreset } from "./CasePreview";
import { generateDesigns } from "../lib/generateDesigns";
import type { Style, Design } from "../lib/wix";
import {
  MODELS,
  UI_MODEL_LABELS,
  FINISHES,
  PRODUCT_ID,
  STORES_APP_ID,
  DESIGN_NOTES_MODIFIER_KEY,
  VARIANT_ID_BY_MODEL_FINISH,
} from "../lib/constants";

const PROMPT_MAX_LENGTH = 280;
// Matches the live product's modifiers[0].freeTextSettings.maxCharCount
// (scripts/seed-store.sh) — the API rejects a customTextFields value longer
// than this, so truncate defensively rather than let add-to-cart fail on it.
const DESIGN_NOTES_MAX_LENGTH = 200;

export interface StudioProps {
  styles: Style[];
  designs: Design[];
  initialStyleSlug?: string;
  initialPrompt?: string;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const STEP_LABELS: string[] = [
  "Model",
  "Prompt & style",
  "Generate",
  "Preview",
  "Finish",
  "Personalize",
  "Review",
];

const GENERATION_PHASES = ["Reading your prompt…", "Composing…", "Rendering…"];
const GENERATION_TOTAL_MS = 2500;

const DEVICE_COLORS: { label: string; value: string }[] = [
  { label: "Graphite", value: "#1c1c1e" },
  { label: "Starlight", value: "#f2eee6" },
  { label: "Sky blue", value: "#a9c6d8" },
  { label: "Sunset gold", value: "#d4af8c" },
];

const LIGHTING_PRESETS: { label: string; value: LightingPreset }[] = [
  { label: "Studio", value: "studio" },
  { label: "Warm", value: "warm" },
  { label: "Neon", value: "neon" },
];

const PERSONALIZATION_MAX = 40;

// FNV-1a over raw bytes — same shape as generateDesigns.ts's string hash, but
// operating on an ArrayBuffer since the inspiration image is never uploaded
// or turned into a giant string; only its byte content seeds the prompt.
async function hashFileBytes(file: File): Promise<number> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export default function Studio({
  styles,
  designs,
  initialStyleSlug,
  initialPrompt,
}: StudioProps) {
  const [step, setStep] = useState<Step>(1);
  const [maxStepReached, setMaxStepReached] = useState<number>(1);

  // Step 1 — model
  const [model, setModel] = useState<string | null>(null);

  // Step 2 — prompt, style, optional inspiration image
  // Clamp on intake: a crafted /studio?prompt=<281+ chars> deep link could
  // otherwise carry an oversized value straight through to the gallery-submit
  // POST (which caps promptText at 300) or just past our own textarea cap.
  const [promptText, setPromptText] = useState(
    (initialPrompt ?? "").slice(0, PROMPT_MAX_LENGTH),
  );
  const [selectedStyleSlug, setSelectedStyleSlug] = useState<string | null>(
    () => (initialStyleSlug && styles.some((s) => s.slug === initialStyleSlug) ? initialStyleSlug : null),
  );
  const [inspirationName, setInspirationName] = useState<string | null>(null);
  const [inspirationHash, setInspirationHash] = useState<number | null>(null);
  const [isHashingImage, setIsHashingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Step 3 — generation + concepts
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationPhase, setGenerationPhase] = useState(0);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [concepts, setConcepts] = useState<Design[]>([]);
  const [selectedDesign, setSelectedDesign] = useState<Design | null>(null);
  const generationTimeouts = useRef<number[]>([]);
  useEffect(() => {
    return () => {
      generationTimeouts.current.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  // Step 4 — preview controls
  const [lighting, setLighting] = useState<LightingPreset>("studio");
  const [deviceColor, setDeviceColor] = useState(DEVICE_COLORS[0].value);

  // Step 5 — finish
  const [finish, setFinish] = useState<string | null>(null);

  // Step 6 — personalization
  const [initials, setInitials] = useState("");
  const [personalName, setPersonalName] = useState("");
  const [personalDate, setPersonalDate] = useState("");

  // Step 7 — add to cart + gallery share
  const [addState, setAddState] = useState<"idle" | "adding" | "added" | "error">("idle");
  const [creatorName, setCreatorName] = useState("");
  const [shareState, setShareState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  // null = not attempted yet; true = customTextFields attached; false = fell
  // back to a bare add (design/personalization metadata was NOT recorded on
  // the order) — surfaced to the visitor rather than only console.warn'd.
  const [metadataAttached, setMetadataAttached] = useState<boolean | null>(null);

  const personalizationCaption = [initials, personalName, personalDate]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" · ");
  const personalizationLength = initials.length + personalName.length + personalDate.length;
  const price = finish === "Leather" ? 79 : 59;

  const handlePersonalizationChange = (
    field: "initials" | "name" | "date",
    value: string,
  ) => {
    const others =
      field === "initials"
        ? personalName.length + personalDate.length
        : field === "name"
          ? initials.length + personalDate.length
          : initials.length + personalName.length;
    const clamped = value.slice(0, Math.max(0, PERSONALIZATION_MAX - others));
    if (field === "initials") setInitials(clamped);
    else if (field === "name") setPersonalName(clamped);
    else setPersonalDate(clamped);
  };

  const handleInspirationChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsHashingImage(true);
    try {
      const hash = await hashFileBytes(file);
      setInspirationHash(hash);
      setInspirationName(file.name);
    } catch (err) {
      console.error("[studio] failed to read inspiration image:", err);
    } finally {
      setIsHashingImage(false);
    }
  };

  const handleRemoveInspiration = () => {
    setInspirationHash(null);
    setInspirationName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const runGeneration = (seedPrompt: string) => {
    const results = generateDesigns(seedPrompt, selectedStyleSlug, designs, 4);
    setConcepts(results);
    setHasGenerated(true);
    setIsGenerating(false);
  };

  const handleGenerate = () => {
    if (!promptText.trim() || designs.length === 0) return;
    const seedPrompt =
      inspirationHash != null ? `${promptText}|img:${inspirationHash}` : promptText;

    setSelectedDesign(null);
    setConcepts([]);
    generationTimeouts.current.forEach((id) => window.clearTimeout(id));
    generationTimeouts.current = [];

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      runGeneration(seedPrompt);
      return;
    }

    setIsGenerating(true);
    setGenerationPhase(0);
    const phaseDuration = GENERATION_TOTAL_MS / GENERATION_PHASES.length;
    GENERATION_PHASES.forEach((_, i) => {
      if (i === 0) return;
      const id = window.setTimeout(() => setGenerationPhase(i), phaseDuration * i);
      generationTimeouts.current.push(id);
    });
    const finalId = window.setTimeout(
      () => runGeneration(seedPrompt),
      phaseDuration * GENERATION_PHASES.length,
    );
    generationTimeouts.current.push(finalId);
  };

  const selectConcept = (design: Design) => {
    setSelectedDesign(design);
    setStep(4);
    setMaxStepReached((m) => Math.max(m, 4));
  };

  const canContinueFromStep = (s: Step): boolean => {
    switch (s) {
      case 1:
        return !!model;
      case 2:
        return promptText.trim().length > 0;
      case 3:
        return !!selectedDesign;
      case 4:
        return !!selectedDesign;
      case 5:
        return !!finish;
      case 6:
        return true;
      default:
        return false;
    }
  };

  const goNext = () => {
    if (!canContinueFromStep(step)) return;
    const next = Math.min(7, step + 1) as Step;
    setStep(next);
    setMaxStepReached((m) => Math.max(m, next));
  };

  const goBack = () => setStep((s) => Math.max(1, s - 1) as Step);

  const goToStep = (s: Step) => {
    if (s <= maxStepReached) setStep(s);
  };

  const resetStudio = () => {
    generationTimeouts.current.forEach((id) => window.clearTimeout(id));
    generationTimeouts.current = [];
    setStep(1);
    setMaxStepReached(1);
    setModel(null);
    setPromptText("");
    setSelectedStyleSlug(null);
    handleRemoveInspiration();
    setIsGenerating(false);
    setHasGenerated(false);
    setConcepts([]);
    setSelectedDesign(null);
    setLighting("studio");
    setDeviceColor(DEVICE_COLORS[0].value);
    setFinish(null);
    setInitials("");
    setPersonalName("");
    setPersonalDate("");
    setAddState("idle");
    setMetadataAttached(null);
    setCreatorName("");
    setShareState("idle");
  };

  const handleAddToCart = async () => {
    if (!model || !finish || !selectedDesign) return;
    setAddState("adding");

    // Combines into the ONE recognized free-text modifier
    // (DESIGN_NOTES_MODIFIER_KEY — scripts/seed-store.sh defines it,
    // freeTextSettings.maxCharCount 200 on the live product). Clamped
    // defensively so a long title/image URL/personalization combo can't
    // exceed the field's server-side limit and throw the whole add away.
    const designNotes = [
      selectedDesign.title,
      selectedDesign.image,
      personalizationCaption || null,
    ]
      .filter(Boolean)
      .join(" | ")
      .slice(0, DESIGN_NOTES_MAX_LENGTH);

    // "iPhone Model" and "Finish" are Product Options (they create variants),
    // not modifiers — per Catalog V3's eCommerce-integration doc, those are
    // selected via catalogReference.options.variantId, NOT the name-matched
    // options.options map (that shape is for TEXT_CHOICES *modifier*
    // selections only, and this product defines none). VARIANT_ID_BY_MODEL_FINISH
    // is a live-resolved lookup (constants.ts) — every value in MODELS x
    // FINISHES has an entry, so a miss here should never happen in practice.
    const variantId = VARIANT_ID_BY_MODEL_FINISH[`${model}|${finish}`];

    try {
      if (!variantId) {
        // Guard for a lookup miss that "shouldn't happen": there's no way to
        // select the right variant without it, so fall back to the bare add
        // rather than blocking the purchase entirely — the visitor is told
        // via the same "Heads up" notice used for the metadata-only fallback
        // below, since neither the exact variant nor the design metadata can
        // be guaranteed on this line item.
        console.error(
          `[studio] no variantId found for model="${model}" finish="${finish}" — falling back to a bare add`,
        );
        await currentCart.addToCurrentCart({
          lineItems: [
            { catalogReference: { appId: STORES_APP_ID, catalogItemId: PRODUCT_ID }, quantity: 1 },
          ],
        });
        setMetadataAttached(false);
      } else {
        const catalogReferenceBase = {
          appId: STORES_APP_ID,
          catalogItemId: PRODUCT_ID,
          options: { variantId },
        };
        try {
          await currentCart.addToCurrentCart({
            lineItems: [
              {
                catalogReference: {
                  ...catalogReferenceBase,
                  options: {
                    ...catalogReferenceBase.options,
                    customTextFields: {
                      [DESIGN_NOTES_MODIFIER_KEY]: designNotes,
                    },
                  },
                },
                quantity: 1,
              },
            ],
          });
          setMetadataAttached(true);
        } catch (withFieldsErr) {
          // Falls back to a variantId-only add rather than blocking the
          // purchase on an ancillary metadata field — but the visitor still
          // needs to know their design/personalization wasn't recorded (see
          // the confirmation panel's notice, gated on metadataAttached === false).
          console.warn(
            "[studio] add-to-cart with the Design Notes modifier failed, retrying without it:",
            withFieldsErr,
          );
          await currentCart.addToCurrentCart({
            lineItems: [{ catalogReference: catalogReferenceBase, quantity: 1 }],
          });
          setMetadataAttached(false);
        }
      }
      window.dispatchEvent(new CustomEvent("caseone:cart-updated"));
      setAddState("added");
    } catch (err) {
      console.error("[studio] add to cart failed:", err);
      setAddState("error");
    }
  };

  const handleShareToGallery = async () => {
    if (!selectedDesign) return;
    setShareState("sending");
    try {
      const response = await fetch("/api/gallery-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: selectedDesign.title,
          image: selectedDesign.image,
          creatorName: creatorName.trim() || "Anonymous",
          promptText,
          styleSlug: selectedStyleSlug ?? selectedDesign.styleSlug,
        }),
      });
      // Fire-and-forget in spirit (no retry/poll loop), but still surface a
      // real rejection (e.g. validation failure) rather than always telling
      // the visitor their submission was accepted.
      if (!response.ok) throw new Error(`gallery-submit responded ${response.status}`);
      setShareState("sent");
    } catch (err) {
      console.error("[studio] gallery share failed:", err);
      setShareState("error");
    }
  };

  const renderStep1 = () => (
    <div className="studio-field">
      <h2>Choose your iPhone model</h2>
      <div className="chip-row" role="group" aria-label="iPhone model">
        {MODELS.map((m) => (
          <button
            key={m}
            type="button"
            className={`chip${model === m ? " is-selected" : ""}`}
            aria-pressed={model === m}
            onClick={() => setModel(m)}
          >
            {UI_MODEL_LABELS[m] ?? m}
          </button>
        ))}
      </div>
    </div>
  );

  const renderStep2 = () => (
    <>
      <h2>Describe your design</h2>
      <div className="studio-field">
        <label htmlFor="studio-prompt" className="studio-label">
          Prompt
        </label>
        <textarea
          id="studio-prompt"
          className="studio-textarea"
          rows={4}
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          placeholder="e.g. a neon cyberpunk skyline reflecting off chrome"
          maxLength={PROMPT_MAX_LENGTH}
        />
      </div>

      {styles.length > 0 ? (
        <div className="studio-field">
          <span className="studio-label">Style (optional)</span>
          <div className="chip-row" role="group" aria-label="Design style">
            <button
              type="button"
              className={`chip${selectedStyleSlug === null ? " is-selected" : ""}`}
              aria-pressed={selectedStyleSlug === null}
              onClick={() => setSelectedStyleSlug(null)}
            >
              Any style
            </button>
            {styles.map((s) => (
              <button
                key={s.slug}
                type="button"
                className={`chip${selectedStyleSlug === s.slug ? " is-selected" : ""}`}
                aria-pressed={selectedStyleSlug === s.slug}
                onClick={() => setSelectedStyleSlug(s.slug)}
              >
                {s.title}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="studio-hint">
          Style filters are unavailable right now — you can still generate without one.
        </p>
      )}

      <div className="studio-field">
        <label htmlFor="studio-inspiration" className="studio-label">
          Inspiration image (optional)
        </label>
        <p className="studio-hint">
          Never uploaded — read on this device only, to nudge your generated concepts.
        </p>
        {inspirationName ? (
          <div className="upload-chip">
            <span>{inspirationName}</span>
            <button type="button" className="btn-ghost" onClick={handleRemoveInspiration}>
              Remove
            </button>
          </div>
        ) : (
          <input
            id="studio-inspiration"
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleInspirationChange}
            disabled={isHashingImage}
          />
        )}
        {isHashingImage && <p className="studio-hint">Reading image…</p>}
      </div>
    </>
  );

  const renderStep3 = () => (
    <>
      <h2>Generate concepts</h2>
      {designs.length === 0 ? (
        <p className="studio-hint">
          The design library is empty right now. Please check back soon.
        </p>
      ) : isGenerating ? (
        <div className="ring-loader-wrap" role="status" aria-live="polite">
          <div className="ring-loader" aria-hidden="true" />
          <p className="ring-loader-caption">{GENERATION_PHASES[generationPhase]}</p>
        </div>
      ) : !hasGenerated ? (
        <div className="generate-cta">
          <p>Ready when you are — we&rsquo;ll compose 4 concepts from your prompt.</p>
          <button
            type="button"
            className="btn-primary"
            onClick={handleGenerate}
            disabled={!promptText.trim()}
          >
            Generate designs
          </button>
        </div>
      ) : concepts.length === 0 ? (
        <div className="generate-cta">
          <p className="studio-hint">
            No stored designs matched that style yet. Try &ldquo;Any style&rdquo; or a different
            prompt.
          </p>
          <button type="button" className="btn-primary" onClick={handleGenerate}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <div className="concept-grid" role="group" aria-label="Generated concepts — choose one">
            {concepts.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`concept-card${selectedDesign?.id === c.id ? " is-selected" : ""}`}
                onClick={() => selectConcept(c)}
              >
                <img src={c.image} alt={c.title} className="concept-thumb" />
                <span className="concept-title">{c.title}</span>
              </button>
            ))}
          </div>
          <button type="button" className="btn-ghost" onClick={handleGenerate}>
            Regenerate
          </button>
        </>
      )}
    </>
  );

  const renderStep4Controls = () => (
    <>
      <h2>Preview in 3D</h2>
      <p className="studio-hint">
        Drag, scroll, or use the arrow keys to rotate and zoom the case.
      </p>
      <div className="studio-field">
        <span className="studio-label">Lighting</span>
        <div className="chip-row" role="group" aria-label="Lighting preset">
          {LIGHTING_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`chip${lighting === p.value ? " is-selected" : ""}`}
              aria-pressed={lighting === p.value}
              onClick={() => setLighting(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="studio-field">
        <span className="studio-label">Device color</span>
        <div className="chip-row" role="group" aria-label="Device color">
          {DEVICE_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`color-swatch${deviceColor === c.value ? " is-selected" : ""}`}
              style={{ backgroundColor: c.value }}
              aria-pressed={deviceColor === c.value}
              aria-label={c.label}
              onClick={() => setDeviceColor(c.value)}
            />
          ))}
        </div>
      </div>
    </>
  );

  const renderStep5Controls = () => (
    <>
      <h2>Choose a finish</h2>
      <div className="chip-row" role="group" aria-label="Finish">
        {FINISHES.map((f) => (
          <button
            key={f}
            type="button"
            className={`chip${finish === f ? " is-selected" : ""}`}
            aria-pressed={finish === f}
            onClick={() => setFinish(f)}
          >
            {f}
            {f === "Leather" && <span className="chip-badge">+$20</span>}
          </button>
        ))}
      </div>
    </>
  );

  const renderStep6Controls = () => (
    <>
      <h2>Personalize (optional)</h2>
      <p className="studio-hint">
        Up to {PERSONALIZATION_MAX} characters total, shown as an engraved-style caption on your
        case.
      </p>
      <div className="personalize-grid">
        <div className="studio-field">
          <label htmlFor="p-initials" className="studio-label">
            Initials
          </label>
          <input
            id="p-initials"
            value={initials}
            onChange={(e) => handlePersonalizationChange("initials", e.target.value)}
          />
        </div>
        <div className="studio-field">
          <label htmlFor="p-name" className="studio-label">
            Name
          </label>
          <input
            id="p-name"
            value={personalName}
            onChange={(e) => handlePersonalizationChange("name", e.target.value)}
          />
        </div>
        <div className="studio-field">
          <label htmlFor="p-date" className="studio-label">
            Date
          </label>
          <input
            id="p-date"
            value={personalDate}
            onChange={(e) => handlePersonalizationChange("date", e.target.value)}
            placeholder="e.g. 2026"
          />
        </div>
      </div>
      <p className="studio-hint" aria-live="polite">
        {PERSONALIZATION_MAX - personalizationLength} characters left
      </p>
    </>
  );

  const renderStep7Controls = () => {
    if (addState === "added") {
      return (
        <div className="confirmation-panel" role="status">
          <p className="confirmation-title">Added to cart</p>
          <p>
            Your {UI_MODEL_LABELS[model ?? ""] ?? model} case in {finish} is on its way to
            checkout.
          </p>
          {metadataAttached === false && (
            <p className="studio-hint" role="alert">
              Heads up — your design and personalization couldn&rsquo;t be attached to this
              order. The model and finish you chose are still correct.
            </p>
          )}
          <div className="confirmation-actions">
            <a href="/cart" className="btn-primary">
              View cart
            </a>
            <button type="button" className="btn-ghost" onClick={resetStudio}>
              Design another
            </button>
          </div>

          <div className="gallery-share">
            <label htmlFor="creator-name" className="studio-label">
              Your name (optional)
            </label>
            <input
              id="creator-name"
              value={creatorName}
              onChange={(e) => setCreatorName(e.target.value)}
              placeholder="Anonymous"
              maxLength={60}
              disabled={shareState === "sent"}
            />
            {shareState === "sent" ? (
              <p className="studio-hint">Sent for review — designs appear once approved.</p>
            ) : (
              <button
                type="button"
                className="btn-ghost"
                onClick={handleShareToGallery}
                disabled={shareState === "sending"}
              >
                {shareState === "sending" ? "Sharing…" : "Share to gallery"}
              </button>
            )}
            {shareState === "error" && (
              <p className="studio-hint" role="alert">
                Couldn&rsquo;t reach the gallery right now — you can try again later.
              </p>
            )}
          </div>
        </div>
      );
    }

    return (
      <>
        <h2>Review &amp; add to cart</h2>
        <div className="price-summary">
          <div className="price-row">
            <span>Model</span>
            <span>{UI_MODEL_LABELS[model ?? ""] ?? model}</span>
          </div>
          <div className="price-row">
            <span>Design</span>
            <span>{selectedDesign?.title}</span>
          </div>
          <div className="price-row">
            <span>Finish</span>
            <span>
              {finish}
              {finish === "Leather" && " (+$20)"}
            </span>
          </div>
          {personalizationCaption && (
            <div className="price-row">
              <span>Personalization</span>
              <span>{personalizationCaption}</span>
            </div>
          )}
          <div className="price-row price-total">
            <span>Total</span>
            <span>${price}</span>
          </div>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={handleAddToCart}
          disabled={addState === "adding"}
        >
          {addState === "adding" ? "Adding…" : "Add to cart"}
        </button>
        {addState === "error" && (
          <p role="alert" className="studio-hint">
            Something went wrong adding this to your cart — please try again.
          </p>
        )}
      </>
    );
  };

  const isConfigStep = step >= 4 && !!selectedDesign;

  let mainContent: React.ReactNode;
  switch (step) {
    case 1:
      mainContent = renderStep1();
      break;
    case 2:
      mainContent = renderStep2();
      break;
    case 3:
      mainContent = renderStep3();
      break;
    case 4:
      mainContent = renderStep4Controls();
      break;
    case 5:
      mainContent = renderStep5Controls();
      break;
    case 6:
      mainContent = renderStep6Controls();
      break;
    case 7:
      mainContent = renderStep7Controls();
      break;
    default:
      mainContent = null;
  }

  return (
    <section className="studio-page" aria-label="AI Design Studio">
      <div className="studio-intro">
        <span className="eyebrow">AI Design Studio</span>
        <h1 className="display">Design your case</h1>
        <p>Describe it, match a curated design, preview in 3D, and make it yours.</p>
      </div>

      <ol className="stepper" aria-label="Design steps">
        {STEP_LABELS.map((label, i) => {
          const s = (i + 1) as Step;
          const reached = s <= maxStepReached;
          return (
            <li key={s}>
              <button
                type="button"
                className={`stepper-button${s === step ? " is-active" : ""}${s < step ? " is-done" : ""}`}
                onClick={() => goToStep(s)}
                disabled={!reached}
                aria-current={s === step ? "step" : undefined}
              >
                <span className="stepper-index">{s}</span>
                <span className="stepper-label">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="studio-panel glass">
        {isConfigStep && selectedDesign ? (
          <div className="studio-config-layout">
            <div className="studio-preview-col">
              <div className="preview-stage">
                <CasePreview
                  designUrl={selectedDesign.image}
                  deviceColor={deviceColor}
                  lighting={lighting}
                  autoRotate={step !== 4}
                  interactive={step === 4}
                />
                {personalizationCaption && (
                  <div className="preview-overlay-caption" aria-hidden="true">
                    {personalizationCaption}
                  </div>
                )}
              </div>
              {finish && <p className="studio-hint price-inline">${price} · {finish}</p>}
            </div>
            <div className="studio-controls-col">{mainContent}</div>
          </div>
        ) : (
          mainContent
        )}

        {step !== 7 && (
          <div className="studio-actions">
            {step > 1 && (
              <button type="button" className="btn-ghost" onClick={goBack}>
                Back
              </button>
            )}
            {step !== 3 && (
              <button
                type="button"
                className="btn-primary"
                onClick={goNext}
                disabled={!canContinueFromStep(step)}
              >
                Continue
              </button>
            )}
          </div>
        )}
        {step === 7 && addState !== "added" && (
          <div className="studio-actions">
            <button type="button" className="btn-ghost" onClick={goBack}>
              Back
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
