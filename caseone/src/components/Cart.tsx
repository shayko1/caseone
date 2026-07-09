import { useEffect, useRef, useState } from "react";
import { currentCart } from "@wix/ecom";
import { redirects } from "@wix/redirects";

// Local structural types — narrower than the SDK's generated types (which use
// `string | null` everywhere) so destructuring below stays simple. We only
// read the fields rendered here; every read is null-checked at the use site.
interface DescriptionLine {
  name?: { translated?: string | null } | null;
  plainText?: { translated?: string | null } | null;
  colorInfo?: { translated?: string | null } | null;
}

interface Availability {
  status?: string | null; // "AVAILABLE" | "NOT_AVAILABLE" | "NOT_FOUND" | "PARTIALLY_AVAILABLE"
  quantityAvailable?: number | null;
}

interface LineItem {
  _id?: string | null;
  productName?: { translated?: string | null } | null;
  quantity?: number | null;
  price?: { formattedConvertedAmount?: string | null } | null;
  fullPrice?: { formattedConvertedAmount?: string | null } | null;
  lineItemPrice?: { amount?: string | null; formattedConvertedAmount?: string | null } | null;
  image?: string | null; // "wix:image://v1/<mediaId>/..." — always a string, never an object
  descriptionLines?: DescriptionLine[] | null;
  availability?: Availability | null;
}

interface CartSummary {
  subtotal?: string;
  discount?: string;
  total?: string;
}

// ── Helpers ──

/** "Model: Matte" / "Color: Coral" — handles both plainText and colorInfo option lines. */
function formatDescriptionLine(line: DescriptionLine): string {
  const title = line.name?.translated ?? undefined;
  const value = line.plainText?.translated ?? line.colorInfo?.translated ?? undefined;
  if (title && value) return `${title}: ${value}`;
  return title ?? value ?? "";
}

/** The SDK returns lineItem.image as "wix:image://v1/<mediaId>/..." — resize via the static CDN. */
function resolveCartImage(image: string | null | undefined, size: number): string | undefined {
  if (!image) return undefined;
  if (image.startsWith("wix:image://")) {
    const match = image.match(/wix:image:\/\/v1\/([^/]+)/);
    return match
      ? `https://static.wixstatic.com/media/${match[1]}/v1/fill/w_${size},h_${size},al_c,q_80/${match[1]}`
      : undefined;
  }
  return image;
}

function isItemUnavailable(item: LineItem): boolean {
  const status = item.availability?.status;
  return status === "NOT_AVAILABLE" || status === "NOT_FOUND";
}

/**
 * `priceSummary.subtotal` is the canonical source. Some early-stage carts
 * (before a checkout has been created) return it empty — fall back to
 * summing `lineItemPrice.amount` client-side so the slot is never blank.
 */
function extractSummary(cart: {
  priceSummary?: { subtotal?: { formattedConvertedAmount?: string }; discount?: { formattedConvertedAmount?: string }; total?: { formattedConvertedAmount?: string } };
  lineItems?: Array<{ lineItemPrice?: { amount?: string } }>;
  currency?: string;
} | undefined): CartSummary {
  const ps = cart?.priceSummary;
  let subtotal = ps?.subtotal?.formattedConvertedAmount;
  const discount = ps?.discount?.formattedConvertedAmount;
  const total = ps?.total?.formattedConvertedAmount;

  if (!subtotal && cart?.lineItems?.length) {
    const sum = cart.lineItems.reduce((acc, item) => acc + Number(item.lineItemPrice?.amount ?? 0), 0);
    if (sum > 0) {
      try {
        subtotal = new Intl.NumberFormat(undefined, { style: "currency", currency: cart.currency ?? "USD" }).format(sum);
      } catch {
        subtotal = sum.toFixed(2);
      }
    }
  }

  return { subtotal, discount, total };
}

function notifyCartUpdated() {
  window.dispatchEvent(new CustomEvent("caseone:cart-updated"));
}

// ── Component ──

export default function Cart() {
  const [items, setItems] = useState<LineItem[]>([]);
  const [summary, setSummary] = useState<CartSummary>({});
  const [loading, setLoading] = useState(true);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  // Guards against out-of-order responses: mutations on different items can
  // resolve in any order. Each mutation captures the sequence number at call
  // time and only applies its response if no newer mutation has started —
  // otherwise a slow response for an earlier click would overwrite state a
  // faster, later click already updated.
  const latestSeq = useRef(0);

  useEffect(() => {
    loadCart();
  }, []);

  // getCurrentCart() returns the cart directly — not wrapped in { cart }. A
  // visitor with no cart yet (nothing ever added) throws here; that's not a
  // failure, it just means the cart is empty.
  async function loadCart() {
    setLoading(true);
    try {
      const cart = await currentCart.getCurrentCart();
      setItems((cart.lineItems as LineItem[]) ?? []);
      setSummary(extractSummary(cart));
    } catch {
      setItems([]);
      setSummary({});
    } finally {
      setLoading(false);
    }
  }

  function setPending(id: string, pending: boolean) {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleUpdateQuantity(itemId: string, quantity: number) {
    if (quantity < 1) return;
    setMutationError(null);
    setPending(itemId, true);
    const seq = ++latestSeq.current;
    try {
      const { cart } = await currentCart.updateCurrentCartLineItemQuantity([{ _id: itemId, quantity }]);
      if (seq === latestSeq.current) {
        setItems((cart?.lineItems as LineItem[]) ?? []);
        setSummary(extractSummary(cart));
      }
      notifyCartUpdated();
    } catch {
      setMutationError("Couldn't update that item — try again.");
    } finally {
      setPending(itemId, false);
    }
  }

  async function handleRemoveItem(itemId: string) {
    setMutationError(null);
    setPending(itemId, true);
    const seq = ++latestSeq.current;
    try {
      const { cart } = await currentCart.removeLineItemsFromCurrentCart([itemId]);
      if (seq === latestSeq.current) {
        setItems((cart?.lineItems as LineItem[]) ?? []);
        setSummary(extractSummary(cart));
      }
      notifyCartUpdated();
    } catch {
      setMutationError("Couldn't remove that item — try again.");
    } finally {
      setPending(itemId, false);
    }
  }

  async function handleCheckout() {
    setCheckoutError(null);
    setCheckingOut(true);
    try {
      const { checkoutId } = await currentCart.createCheckoutFromCurrentCart({
        channelType: currentCart.ChannelType.WEB,
      });
      const { redirectSession } = await redirects.createRedirectSession({
        ecomCheckout: { checkoutId },
        callbacks: {
          postFlowUrl: window.location.origin,
          thankYouPageUrl: `${window.location.origin}/thank-you`,
          cartPageUrl: `${window.location.origin}/cart`,
        },
      });
      if (!redirectSession?.fullUrl) throw new Error("missing redirect url");
      window.location.href = redirectSession.fullUrl;
    } catch {
      setCheckoutError("Checkout couldn't start — try again.");
      setCheckingOut(false);
    }
  }

  // ── Render ──

  if (loading) {
    return (
      <div className="cart-grid">
        <div className="cart-items">
          {[0, 1].map((i) => (
            <div key={i} className="cart-item">
              <div className="skeleton cart-item-image" />
              <div className="cart-item-info">
                <div className="skeleton skeleton-line" style={{ width: "60%" }} />
                <div className="skeleton skeleton-line" style={{ width: "40%" }} />
              </div>
            </div>
          ))}
        </div>
        <div className="skeleton cart-summary-skeleton" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="cart-empty glass">
        <p>Your cart is empty.</p>
        <a href="/studio" className="btn-primary">Design Yours</a>
      </div>
    );
  }

  const hasUnavailable = items.some(isItemUnavailable);

  return (
    <div className="cart-grid">
      <div className="cart-items">
        {mutationError && (
          <div className="cart-error" role="alert">
            <span>{mutationError}</span>
            <button className="btn-ghost" onClick={loadCart}>Retry</button>
          </div>
        )}

        {items.map((item) => {
          const id = item._id ?? "";
          const unavailable = isItemUnavailable(item);
          const isPending = pendingIds.has(id);
          const imgSrc = resolveCartImage(item.image, 160);
          const maxQty = item.availability?.quantityAvailable ?? 99;
          const hasDiscount =
            item.fullPrice?.formattedConvertedAmount &&
            item.fullPrice.formattedConvertedAmount !== item.price?.formattedConvertedAmount;

          return (
            <div key={id || item.productName?.translated} className="cart-item">
              {imgSrc ? (
                <a href="/product" className="cart-item-image-link">
                  <img src={imgSrc} alt={item.productName?.translated ?? ""} className="cart-item-image" />
                </a>
              ) : (
                <div className="cart-item-image cart-item-image-placeholder" aria-hidden="true" />
              )}

              <div className="cart-item-info">
                <h3 className="cart-item-name">
                  <a href="/product" className="cart-item-name-link">{item.productName?.translated}</a>
                </h3>

                {(item.descriptionLines ?? []).map((line, i) => {
                  const text = formatDescriptionLine(line);
                  return text ? <p key={i} className="cart-item-option">{text}</p> : null;
                })}

                {unavailable ? (
                  <p className="cart-item-unavailable">
                    {item.availability?.status === "NOT_FOUND" ? "No longer available" : "Out of stock"}
                  </p>
                ) : (
                  <div className="cart-item-qty">
                    <button
                      type="button"
                      className="qty-btn"
                      disabled={isPending || (item.quantity ?? 1) <= 1}
                      onClick={() => id && handleUpdateQuantity(id, (item.quantity ?? 1) - 1)}
                      aria-label="Decrease quantity"
                    >
                      &minus;
                    </button>
                    {isPending ? (
                      <span className="skeleton qty-skeleton" aria-hidden="true" />
                    ) : (
                      <span className="qty-value">{item.quantity}</span>
                    )}
                    <button
                      type="button"
                      className="qty-btn"
                      disabled={isPending || (item.quantity ?? 0) >= maxQty}
                      onClick={() => id && handleUpdateQuantity(id, (item.quantity ?? 1) + 1)}
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                )}
              </div>

              <div className="cart-item-actions">
                <div className="cart-item-prices">
                  {hasDiscount && (
                    <span className="cart-item-full-price">{item.fullPrice!.formattedConvertedAmount}</span>
                  )}
                  <span className="cart-item-unit-price">{item.price?.formattedConvertedAmount}</span>
                </div>
                {(item.quantity ?? 1) > 1 && (
                  <p className="cart-item-line-total">{item.lineItemPrice?.formattedConvertedAmount}</p>
                )}
                <button
                  type="button"
                  className="cart-item-remove"
                  disabled={isPending}
                  onClick={() => id && handleRemoveItem(id)}
                >
                  {isPending ? "Removing…" : "Remove"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="cart-summary glass">
        <div className="cart-subtotal">
          <span>Subtotal</span>
          <span>{summary.subtotal ?? "—"}</span>
        </div>
        {summary.discount && (
          <div className="cart-discount">
            <span>Discount</span>
            <span>&minus;{summary.discount}</span>
          </div>
        )}
        {summary.total && summary.total !== summary.subtotal && (
          <div className="cart-total">
            <span>Total</span>
            <span>{summary.total}</span>
          </div>
        )}
        {hasUnavailable && (
          <p className="cart-item-unavailable">Remove unavailable items before checking out.</p>
        )}
        {checkoutError && <p className="cart-error" role="alert">{checkoutError}</p>}
        <button
          type="button"
          className="checkout-btn"
          onClick={handleCheckout}
          disabled={checkingOut || hasUnavailable || pendingIds.size > 0}
        >
          {checkingOut ? "Redirecting to checkout…" : "Checkout"}
        </button>
      </div>
    </div>
  );
}
