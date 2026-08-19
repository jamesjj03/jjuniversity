import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const projectRoot = process.cwd();
const brandDir = path.join(projectRoot, "public", "branding", "jju");
const pngDir = path.join(brandDir, "png");
const appIconDir = path.join(brandDir, "app-icons");
const readerFontDir = path.join(projectRoot, "public", "fonts", "reader");
const geometry = JSON.parse(
  await fs.readFile(path.join(brandDir, "logo-geometry.json"), "utf8"),
);

const escapeXml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function markSvg(color, options = {}) {
  const {
    background = null,
    padding = 0,
    title = geometry.name,
  } = options;
  const contentWidth = geometry.width + padding * 2;
  const contentHeight = geometry.height + padding * 2;
  const outerWidth = background ? Math.max(contentWidth, contentHeight) : contentWidth;
  const outerHeight = background ? Math.max(contentWidth, contentHeight) : contentHeight;
  const markX = padding + (outerWidth - contentWidth) / 2;
  const markY = padding + (outerHeight - contentHeight) / 2;
  const backgroundRect = background
    ? `<rect width="${outerWidth}" height="${outerHeight}" rx="${Math.max(0, padding * 0.34)}" fill="${background}"/>`
    : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${outerWidth} ${outerHeight}" role="img" aria-labelledby="title">`,
    `<title id="title">${escapeXml(title)}</title>`,
    backgroundRect,
    `<g transform="translate(${markX} ${markY})" fill="${color}">`,
    `<path d="${geometry.u.path}"/>`,
    ...geometry.js.map((letter) => `<path d="${letter.path}"/>`),
    "</g>",
    "</svg>",
  ].join("");
}

function lockupSvg({ background, markColor, wordColor }) {
  const markX = 20;
  const markY = 16;
  const markHeight = 84;
  const markWidth = markHeight * geometry.width / geometry.height;
  const dividerX = markX + markWidth + 24;
  const wordX = dividerX + 25;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 116" role="img" aria-labelledby="title">`,
    `<title id="title">JJ University</title>`,
    `<rect width="500" height="116" rx="8" fill="${background}"/>`,
    `<g transform="translate(${markX} ${markY}) scale(${markWidth / geometry.width} ${markHeight / geometry.height})" fill="${markColor}">`,
    `<path d="${geometry.u.path}"/>`,
    ...geometry.js.map((letter) => `<path d="${letter.path}"/>`),
    "</g>",
    `<path d="M ${dividerX} 24 V 92" stroke="${markColor}" stroke-opacity="0.48" stroke-width="1.5"/>`,
    `<text x="${wordX}" y="69" fill="${wordColor}" font-family="Bricolage Grotesque, Arial, sans-serif" font-size="34" font-weight="700" letter-spacing="-0.8">JJ University</text>`,
    "</svg>",
  ].join("");
}

function makeIco(images) {
  const headerSize = 6 + images.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = headerSize;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

await fs.mkdir(pngDir, { recursive: true });
await fs.mkdir(appIconDir, { recursive: true });
await fs.mkdir(readerFontDir, { recursive: true });

const variants = {
  gold: geometry.colors.gold,
  cream: geometry.colors.cream,
  charcoal: geometry.colors.charcoal,
  "near-black": geometry.colors.nearBlack,
  white: geometry.colors.white,
};

for (const [name, color] of Object.entries(variants)) {
  const svg = markSvg(color);
  await fs.writeFile(path.join(brandDir, `jju-mark-${name}.svg`), `${svg}\n`);
  for (const size of [24, 32, 48, 64, 128, 256, 512, 1024]) {
    const png = await sharp(Buffer.from(svg))
      .resize({ width: size, height: size, fit: "contain" })
      .png()
      .toBuffer();
    await fs.writeFile(path.join(pngDir, `jju-mark-${name}-${size}.png`), png);
  }
}

const appSvg = markSvg(geometry.colors.gold, {
  background: geometry.colors.deepNavy,
  padding: 24,
  title: "JJ University app icon",
});
for (const size of [192, 512, 1024]) {
  const png = await sharp(Buffer.from(appSvg))
    .resize(size, size)
    .png()
    .toBuffer();
  await fs.writeFile(path.join(appIconDir, `jju-app-icon-${size}.png`), png);
}

const appleIcon = await sharp(Buffer.from(appSvg)).resize(180, 180).png().toBuffer();
await fs.writeFile(path.join(appIconDir, "jju-apple-touch-icon-180.png"), appleIcon);

const faviconImages = [];
for (const size of [16, 32, 48]) {
  const data = await sharp(Buffer.from(appSvg)).resize(size, size).png().toBuffer();
  faviconImages.push({ size, data });
}
await fs.writeFile(path.join(brandDir, "jju-favicon.ico"), makeIco(faviconImages));

await fs.copyFile(
  path.join(brandDir, "jju-favicon.ico"),
  path.join(projectRoot, "app", "favicon.ico"),
);
await fs.copyFile(
  path.join(appIconDir, "jju-app-icon-192.png"),
  path.join(projectRoot, "app", "icon.png"),
);
await fs.copyFile(
  path.join(appIconDir, "jju-apple-touch-icon-180.png"),
  path.join(projectRoot, "app", "apple-icon.png"),
);

await fs.writeFile(
  path.join(brandDir, "jju-lockup-dark.svg"),
  `${lockupSvg({
    background: geometry.colors.deepNavy,
    markColor: geometry.colors.gold,
    wordColor: geometry.colors.cream,
  })}\n`,
);
await fs.writeFile(
  path.join(brandDir, "jju-lockup-light.svg"),
  `${lockupSvg({
    background: geometry.colors.cream,
    markColor: geometry.colors.gold,
    wordColor: geometry.colors.nearBlack,
  })}\n`,
);

await fs.writeFile(
  path.join(projectRoot, "app", "site-v2", "icon.svg"),
  `${markSvg(geometry.colors.gold, {
    background: geometry.colors.deepNavy,
    padding: 24,
    title: "JJ University",
  })}\n`,
);
await fs.copyFile(
  path.join(appIconDir, "jju-apple-touch-icon-180.png"),
  path.join(projectRoot, "app", "site-v2", "apple-icon.png"),
);
await fs.copyFile(
  path.join(projectRoot, "node_modules", "@fontsource", "atkinson-hyperlegible", "files", "atkinson-hyperlegible-latin-400-normal.woff2"),
  path.join(readerFontDir, "atkinson-hyperlegible-400.woff2"),
);
await fs.copyFile(
  path.join(projectRoot, "node_modules", "@fontsource", "atkinson-hyperlegible", "files", "atkinson-hyperlegible-latin-700-normal.woff2"),
  path.join(readerFontDir, "atkinson-hyperlegible-700.woff2"),
);
await fs.copyFile(
  path.join(projectRoot, "node_modules", "@fontsource", "atkinson-hyperlegible", "LICENSE"),
  path.join(readerFontDir, "OFL.txt"),
);

console.log(`Generated JJ University brand assets in ${brandDir}`);
