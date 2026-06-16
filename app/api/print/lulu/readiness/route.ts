import { NextResponse } from "next/server";
import { getLuluConfigStatus, getLuluReadiness } from "@/lib/lulu";
import { getPrintProduct, PRINT_PRODUCTS } from "@/lib/publishing";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const productSlug = url.searchParams.get("productSlug") || url.searchParams.get("product") || "";
  const config = getLuluConfigStatus();

  if (productSlug) {
    const product = getPrintProduct(productSlug);
    if (!product) {
      return NextResponse.json({ error: "Print product not found." }, { status: 404 });
    }

    const readiness = getLuluReadiness(product);
    return NextResponse.json({
      configured: config.configured,
      missingConfig: config.missing,
      product: summarizeProduct(product),
      readiness,
    });
  }

  return NextResponse.json({
    configured: config.configured,
    missingConfig: config.missing,
    products: PRINT_PRODUCTS.map(product => ({
      ...summarizeProduct(product),
      readiness: getLuluReadiness(product),
    })),
  });
}

function summarizeProduct(product: (typeof PRINT_PRODUCTS)[number]) {
  return {
    slug: product.slug,
    title: product.title,
    kind: product.kind,
    printStatus: product.printStatus,
    salesStatus: product.salesStatus,
    actualInteriorPages: product.actualInteriorPages,
    podPackageId: product.podPackageId || "",
    hasPublicInteriorUrl: Boolean(product.publicInteriorUrl),
    hasPublicCoverUrl: Boolean(product.publicCoverUrl),
  };
}
