import { NextResponse } from "next/server";
import {
  buildLuluCostPayload,
  calculateLuluPrintJobCost,
  getLuluConfigStatus,
  getLuluReadiness,
  missingLuluShippingAddressFields,
  normalizeLuluShippingAddress,
  type LuluShippingLevel,
} from "@/lib/lulu";
import { getPrintProduct } from "@/lib/publishing";

export const runtime = "nodejs";

const SHIPPING_LEVELS = new Set<LuluShippingLevel>([
  "MAIL",
  "PRIORITY_MAIL",
  "GROUND_HD",
  "GROUND_BUS",
  "GROUND",
  "EXPRESS",
]);

type QuoteBody = {
  productSlug?: string;
  shippingAddress?: unknown;
  shipping_address?: unknown;
  shippingOption?: string;
  shipping_option?: string;
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as QuoteBody;
  const product = getPrintProduct(String(body.productSlug || ""));

  if (!product) {
    return NextResponse.json({ error: "Print product not found." }, { status: 404 });
  }

  const config = getLuluConfigStatus();
  const readiness = getLuluReadiness(product);
  const shippingAddress = normalizeLuluShippingAddress(body.shippingAddress || body.shipping_address);
  const shippingMissing = missingLuluShippingAddressFields(shippingAddress);
  const missing = [...config.missing, ...readiness.missing, ...shippingMissing];

  if (missing.length) {
    return NextResponse.json({
      error: "This paperback is not ready for a Lulu quote yet.",
      missing,
      product: {
        slug: product.slug,
        title: product.title,
        printStatus: product.printStatus,
        salesStatus: product.salesStatus,
      },
      readiness,
    }, { status: config.missing.length ? 503 : 409 });
  }

  const shippingOption = normalizeShippingLevel(body.shippingOption || body.shipping_option);
  const payload = buildLuluCostPayload(product, shippingAddress, shippingOption);
  const quote = await calculateLuluPrintJobCost(payload);

  return NextResponse.json({
    productSlug: product.slug,
    shippingOption,
    quote,
  });
}

function normalizeShippingLevel(value: unknown): LuluShippingLevel {
  const candidate = String(value || "MAIL").trim().toUpperCase() as LuluShippingLevel;
  return SHIPPING_LEVELS.has(candidate) ? candidate : "MAIL";
}
