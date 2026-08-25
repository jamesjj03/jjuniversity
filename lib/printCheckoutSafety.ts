import "server-only";

type CheckoutProduct = {
  salesStatus?: string | null;
  targetPriceCents?: number | null;
};

const OPERATOR_ENABLE_VALUE = "1";

export const PRINT_CHECKOUT_SAFE_CONDITION = "server-verified-lulu-delivered-cost-v1";

type PrintCheckoutReadinessBase = {
  reason: string;
  safeCondition: typeof PRINT_CHECKOUT_SAFE_CONDITION;
  missing: string[];
  requiredQuoteCosts: readonly ["manufacturing", "fulfillment", "shipping", "tax"];
};

export type PrintCheckoutReadiness = PrintCheckoutReadinessBase & ({
  ready: false;
  code: "print-checkout-locked";
  chargeAmountCents: null;
  quoteBindingId: null;
} | {
  ready: true;
  code: "ready";
  chargeAmountCents: number;
  quoteBindingId: string;
});

/**
 * Print checkout stays fail-closed until the application can bind a current,
 * server-verified Lulu delivered-cost quote to the exact destination and
 * Stripe amount. The existing quote endpoint does not issue that binding, so
 * a catalog target price must never be treated as a chargeable amount.
 */
export function getPrintCheckoutReadiness(product?: CheckoutProduct | null): PrintCheckoutReadiness {
  const missing: string[] = [];

  if (!product) {
    missing.push("print_product");
  } else {
    if (product.salesStatus !== "checkout-live") missing.push("product_checkout_approval");
    if (!Number.isSafeInteger(product.targetPriceCents) || Number(product.targetPriceCents) < 100) {
      missing.push("valid_catalog_target_price");
    }
  }

  if (process.env.JJU_PRINT_CHECKOUT_ENABLED !== OPERATOR_ENABLE_VALUE) {
    missing.push("JJU_PRINT_CHECKOUT_ENABLED");
  }

  // Deliberately unresolved: no signed/opaque quote token currently binds the
  // current Lulu totals, destination, expiry, product, and Stripe charge.
  missing.push("server_verified_lulu_delivered_cost_quote");
  missing.push("quote_bound_stripe_charge_amount");

  return {
    ready: false,
    code: "print-checkout-locked",
    reason: "Checkout is locked until explicit sale approval and a current server-verified Lulu quote—including manufacturing, fulfillment, shipping, and tax—are bound to the exact destination and Stripe charge. A catalog target price is never chargeable by itself.",
    safeCondition: PRINT_CHECKOUT_SAFE_CONDITION,
    missing,
    requiredQuoteCosts: ["manufacturing", "fulfillment", "shipping", "tax"],
    chargeAmountCents: null,
    quoteBindingId: null,
  };
}
