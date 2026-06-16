import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getPrintProduct, SITE_URL } from "@/lib/publishing";
import { createSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabaseAdmin";
import { getStripe, hasStripeConfig } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { productSlug?: string };
  const product = getPrintProduct(String(body.productSlug || ""));

  if (!product) {
    return NextResponse.json({ error: "Print product not found." }, { status: 404 });
  }

  if (product.salesStatus !== "checkout-live") {
    return NextResponse.json({ error: "This paperback is not for sale yet." }, { status: 409 });
  }

  if (!hasStripeConfig()) {
    return NextResponse.json({ error: "Stripe checkout is not configured yet." }, { status: 503 });
  }

  if (!hasSupabaseAdminConfig()) {
    return NextResponse.json({ error: "Order storage is not configured yet." }, { status: 503 });
  }

  if (!product.targetPriceCents || product.targetPriceCents < 100) {
    return NextResponse.json({ error: "This paperback needs a valid price before checkout can open." }, { status: 409 });
  }

  const stripe = getStripe();
  const supabase = createSupabaseAdminClient();
  const successUrl = `${SITE_URL}/print/${product.slug}?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${SITE_URL}/print/${product.slug}?checkout=cancelled`;
  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = product.stripePriceId
    ? { price: product.stripePriceId, quantity: 1 }
    : {
      price_data: {
        currency: "usd",
        unit_amount: product.targetPriceCents,
        product_data: {
          name: product.title,
          description: product.subtitle || product.description,
          metadata: {
            productSlug: product.slug,
            sku: product.sku,
            printStatus: product.printStatus,
          },
        },
      },
      quantity: 1,
    };

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [lineItem],
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_creation: "if_required",
    phone_number_collection: { enabled: true },
    shipping_address_collection: {
      allowed_countries: ["US"],
    },
    metadata: {
      productSlug: product.slug,
      sku: product.sku,
      printStatus: product.printStatus,
    },
  });

  const { error } = await supabase.from("print_orders").insert({
    product_slug: product.slug,
    status: "checkout_created",
    amount_cents: product.targetPriceCents,
    currency: "usd",
    stripe_checkout_session_id: session.id,
    metadata: {
      sku: product.sku,
      printStatus: product.printStatus,
      checkoutMode: "payment",
    },
  });

  if (error) {
    return NextResponse.json({ error: "Could not store print order." }, { status: 500 });
  }

  return NextResponse.json({ url: session.url });
}
