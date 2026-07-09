import { useEffect, useState } from "react";
import { currentCart } from "@wix/ecom";

export default function CartBadge() {
	const [count, setCount] = useState(0);

	async function fetchCount() {
		try {
			const cart = await currentCart.getCurrentCart();
			const total = (cart.lineItems ?? []).reduce((sum, item) => sum + (item.quantity ?? 0), 0);
			setCount(total);
		} catch {
			// No cart yet for this visitor, or a transient error — either way, show 0.
			setCount(0);
		}
	}

	useEffect(() => {
		fetchCount();

		const handleCartUpdated = () => fetchCount();
		const handleVisibilityChange = () => {
			if (document.visibilityState === "visible") fetchCount();
		};

		window.addEventListener("caseone:cart-updated", handleCartUpdated);
		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => {
			window.removeEventListener("caseone:cart-updated", handleCartUpdated);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, []);

	return (
		<a href="/cart" className="cart-badge" aria-label={count > 0 ? `Cart, ${count} items` : "Cart"}>
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.8"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<circle cx="9" cy="21" r="1" />
				<circle cx="20" cy="21" r="1" />
				<path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
			</svg>
			{count > 0 && <span className="cart-badge-count">{count}</span>}
		</a>
	);
}
