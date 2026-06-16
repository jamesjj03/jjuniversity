import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
export const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

export function hasStripeConfig() {
  return Boolean(stripeSecretKey);
}

export function getStripe() {
  if (!stripeSecretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY.");
  }

  return new Stripe(stripeSecretKey, {
    typescript: true,
  });
}
