import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  buildLuluPrintJobPayload,
  createLuluPrintJob,
  getLuluConfigStatus,
  getLuluJobId,
  getLuluReadiness,
  missingLuluShippingAddressFields,
  normalizeLuluShippingAddress,
  shouldAutoSubmitLuluJobs,
} from "@/lib/lulu";
import { getPrintProduct } from "@/lib/publishing";
import { createSupabaseAdminClient, hasSupabaseAdminConfig } from "@/lib/supabaseAdmin";
import { getStripe, hasStripeConfig, stripeWebhookSecret } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasStripeConfig() || !stripeWebhookSecret) {
    return NextResponse.json({ error: "Stripe webhook is not configured yet." }, { status: 503 });
  }

  if (!hasSupabaseAdminConfig()) {
    return NextResponse.json({ error: "Order storage is not configured yet." }, { status: 503 });
  }

  const stripe = getStripe();
  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, stripeWebhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const supabase = createSupabaseAdminClient();
    const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;
    const email = session.customer_details?.email || session.customer_email || null;
    const productSlug = session.metadata?.productSlug || "";
    const product = getPrintProduct(productSlug);
    const shippingAddress = normalizeLuluShippingAddress({
      ...(session.customer_details?.address || {}),
      name: session.customer_details?.name || "",
      email: email || "",
      phone: session.customer_details?.phone || "",
    });
    const luluState = await resolveLuluFulfillmentState({
      checkoutSessionId: session.id,
      email,
      product,
      shippingAddress,
    });

    await supabase
      .from("print_orders")
      .update({
        email,
        status: luluState.status,
        stripe_payment_intent_id: paymentIntent,
        lulu_print_job_id: luluState.printJobId || null,
        shipping_address: session.customer_details?.address || {},
        metadata: {
          stripeStatus: session.status,
          paymentStatus: session.payment_status,
          productSlug,
          sku: session.metadata?.sku || "",
          lulu: luluState.metadata,
        },
      })
      .eq("stripe_checkout_session_id", session.id);
  }

  return NextResponse.json({ received: true });
}

async function resolveLuluFulfillmentState({
  checkoutSessionId,
  email,
  product,
  shippingAddress,
}: {
  checkoutSessionId: string;
  email: string | null;
  product: ReturnType<typeof getPrintProduct>;
  shippingAddress: ReturnType<typeof normalizeLuluShippingAddress>;
}) {
  const autoSubmit = shouldAutoSubmitLuluJobs();
  const config = getLuluConfigStatus();
  const missing = [
    ...config.missing,
    ...(product ? getLuluReadiness(product).missing : ["print_product"]),
    ...missingLuluShippingAddressFields(shippingAddress),
  ];

  if (!autoSubmit) {
    return {
      status: "paid_lulu_pending",
      printJobId: "",
      metadata: {
        autoSubmit,
        missing,
        configured: config.configured,
      },
    };
  }

  if (!product || !email || missing.length) {
    return {
      status: "paid_lulu_blocked",
      printJobId: "",
      metadata: {
        autoSubmit,
        missing: email ? missing : [...missing, "customer_email"],
        configured: config.configured,
      },
    };
  }

  try {
    const payload = buildLuluPrintJobPayload({
      product,
      shippingAddress,
      contactEmail: process.env.LULU_CONTACT_EMAIL || email,
      externalId: `stripe-${checkoutSessionId}`,
      shippingLevel: "MAIL",
    });
    const response = await createLuluPrintJob(payload);
    const printJobId = getLuluJobId(response);

    return {
      status: "submitted_to_lulu",
      printJobId,
      metadata: {
        autoSubmit,
        missing: [],
        response,
      },
    };
  } catch (error) {
    return {
      status: "paid_lulu_error",
      printJobId: "",
      metadata: {
        autoSubmit,
        missing,
        error: error instanceof Error ? error.message : "Unknown Lulu submission error.",
      },
    };
  }
}
