import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const productsPath = join(root, "public", "print-products.json");
const args = parseArgs(process.argv.slice(2));
const slug = args.product || args.slug;

if (!slug) {
  usage("Missing --product.");
}

const products = JSON.parse(readFileSync(productsPath, "utf8"));
const product = products.find(item => item.slug === slug);

if (!product) {
  usage(`No print product found for "${slug}".`);
}

const changes = {
  podPackageId: args["pod-package-id"] || args.podPackageId,
  publicInteriorUrl: args["interior-url"] || args.publicInteriorUrl,
  publicCoverUrl: args["cover-url"] || args.publicCoverUrl,
  stripePriceId: args["stripe-price-id"] || args.stripePriceId,
  luluProjectId: args["lulu-project-id"] || args.luluProjectId,
  printStatus: args["print-status"] || args.printStatus,
  salesStatus: args["sales-status"] || args.salesStatus,
};

const applied = Object.entries(changes).filter(([, value]) => value !== undefined);

if (!applied.length) {
  usage("Nothing to update. Pass at least one asset/status flag.");
}

for (const [key, value] of applied) {
  product[key] = String(value || "").trim();
}

if (args["dry-run"]) {
  console.log(JSON.stringify(product, null, 2));
  process.exit(0);
}

writeFileSync(productsPath, `${JSON.stringify(products, null, 2)}\n`);
console.log(`Updated ${product.slug}: ${applied.map(([key]) => key).join(", ")}`);

function parseArgs(values) {
  const parsed = {};
  for (const value of values) {
    if (!value.startsWith("--")) continue;
    const [rawKey, ...rawValue] = value.slice(2).split("=");
    parsed[rawKey] = rawValue.length ? rawValue.join("=") : true;
  }
  return parsed;
}

function usage(error) {
  if (error) console.error(error);
  console.error([
    "Usage:",
    "  node scripts/set-print-product-assets.mjs --product=101-volume-1 --pod-package-id=0600X0900.BW.STD.PB.060UW444.MXX --interior-url=https://.../interior.pdf --cover-url=https://.../cover-wrap.pdf",
    "",
    "Optional:",
    "  --stripe-price-id=price_...",
    "  --lulu-project-id=...",
    "  --print-status=lulu-validated",
    "  --sales-status=not-for-sale|notify|checkout-live",
    "  --dry-run",
  ].join("\n"));
  process.exit(1);
}
