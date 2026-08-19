"use client";

import { useState } from "react";

type Props = {
  productSlug: string;
  salesStatus: string;
  returnPath?: string;
};

export default function PrintCheckoutButton({ productSlug, salesStatus, returnPath }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const checkoutLive = salesStatus === "checkout-live";

  async function startCheckout() {
    if (!checkoutLive || busy) return;
    setBusy(true);
    setMessage("");

    try {
      const response = await fetch("/api/print/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productSlug, returnPath }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.url) {
        throw new Error(data.error || "Checkout is not available yet.");
      }

      window.location.assign(data.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checkout is not available yet.");
      setBusy(false);
    }
  }

  return (
    <div className="printCheckoutControl">
      <button className="btn primary" type="button" disabled={!checkoutLive || busy} onClick={startCheckout}>
        {busy ? "Opening checkout..." : checkoutLive ? "Buy Paperback" : "Paperback not live yet"}
      </button>
      {message && <p>{message}</p>}
    </div>
  );
}
