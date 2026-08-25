import { getPrintProofPreviewAsset, readPrintProofPreview } from "@/lib/printProofGallery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "Vary": "Authorization",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ asset: string }> },
) {
  const { asset: assetId } = await params;
  const asset = getPrintProofPreviewAsset(assetId);
  if (!asset) {
    return Response.json({ error: "Proof preview not found." }, { status: 404, headers: PRIVATE_HEADERS });
  }

  try {
    const { bytes, sha256 } = await readPrintProofPreview(asset);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Disposition": `inline; filename="${asset.fileName}"`,
        "Content-Length": String(bytes.byteLength),
        "Content-Type": "image/png",
        "ETag": `"sha256-${sha256}"`,
        "X-JJU-Proof-Preview-SHA256": sha256,
      },
    });
  } catch {
    return Response.json(
      { error: "This proof preview is unavailable. No fallback file was exposed." },
      { status: 404, headers: PRIVATE_HEADERS },
    );
  }
}
