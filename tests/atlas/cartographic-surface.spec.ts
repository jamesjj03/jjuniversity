import { expect, test, type Locator, type Page } from "@playwright/test";
import { atlasLabelInk } from "../../lib/atlas-world/labelInk";
import politicalPalette from "../../lib/atlas-world/data/political-palette.v1.json";

// This protects the approved material/readability contract, not a particular
// palette or screenshot. Text contrast is checked against the nominal country
// paint or a crisp local keyline; it is not a WCAG claim about every raster pixel.
const VIEWS = [
  ["political", "Political"],
  ["government", "Government"],
  ["religion", "Religion"],
  ["population", "Population"],
  ["gdp-per-capita", "GDP per capita"],
  ["where-people-live", "Where people live"],
] as const;

type Rgba = [number, number, number, number];

function luminance(color: Rgba) {
  const linear = color.slice(0, 3).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground[3];
  return [
    foreground[0] * alpha + background[0] * (1 - alpha),
    foreground[1] * alpha + background[1] * (1 - alpha),
    foreground[2] * alpha + background[2] * (1 - alpha),
    1,
  ];
}

function contrast(first: Rgba, second: Rgba) {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("label ink stays readable across the entire Political palette and light/dark paints", () => {
  const rgba = (hex: string, alpha = 1): Rgba => {
    expect(hex).toMatch(/^#[\da-f]{6}$/i);
    const channels = hex.slice(1).match(/../g)!.map((value) => parseInt(value, 16));
    return [channels[0], channels[1], channels[2], alpha];
  };
  // This is the authored underlying land paint used by atlasLabelInk. It is not
  // a claim that every relief pixel shares this color; browser checks below
  // separately protect computed label styles and crisp non-Political keylines.
  const base: Rgba = [177, 180, 154, 1];
  const paints: Array<[string, string]> = [
    ...Object.entries(politicalPalette.colors),
    ["dark blue", "#223343"], ["dark green", "#223e40"],
    ["light neutral", "#fff7dd"], ["middle neutral", "#8f8570"],
  ];
  for (const [name, color] of paints) {
    for (const opacity of [1, 0.65, 0]) {
      const background = composite(rgba(color, opacity), base);
      const paint = atlasLabelInk(color, opacity);
      const ink = rgba(paint.fill);
      const direct = contrast(ink, background);
      expect(paint.needsKeyline, `${name}, opacity ${opacity}: keyline only when needed`).toBe(direct < 4.5);
      const readingContrast = paint.needsKeyline ? contrast(ink, rgba(paint.keyline)) : direct;
      expect(readingContrast, `${name}, opacity ${opacity}: nominal small-text contrast`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

async function openAtlas(page: Page, query: string) {
  await page.goto(`/atlas${query}`, { waitUntil: "domcontentloaded" });
  // SVG labels precede client camera initialization; do not inspect their
  // initial server coordinates or click before the map handlers attach.
  await expect(page.locator("[data-atlas-map-group]")).toHaveAttribute("transform", /scale\(/);
}

async function chooseCountry(page: Page, name: string) {
  const search = page.getByRole("combobox", { name: "Find a country, city, river, or lake", exact: true });
  if (!await search.isVisible()) await page.getByRole("button", { name: "Find a place", exact: true }).click();
  await search.fill(name);
  await page.getByRole("option", { name: new RegExp(`^${name}(?:\\s|$)`) }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

async function chooseView(page: Page, name: string) {
  await page.getByRole("button", { name: /^Choose view:/ }).click();
  const dialog = page.getByRole("dialog", { name: "Explore the map", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name, exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: `Choose view: ${name}`, exact: true })).toBeVisible();
}

async function paintEffects(locator: Locator) {
  return locator.evaluate((element) => {
    const css = getComputedStyle(element);
    const ancestors = [];
    for (let current: Element | null = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      ancestors.push({ filter: style.filter, textShadow: style.textShadow });
      if (current.hasAttribute("data-atlas-root")) break;
    }
    return { fill: css.fill, stroke: css.stroke, strokeWidth: parseFloat(css.strokeWidth),
      backgroundImage: css.backgroundImage, boxShadow: css.boxShadow, ancestors };
  });
}

async function labelPaint(locator: Locator) {
  return locator.evaluate((element) => {
    const label = element as SVGTextElement;
    const css = getComputedStyle(label);
    const matrix = label.getScreenCTM()!;
    const scale = Math.hypot(matrix.a, matrix.b);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const rgba = (color: string): Rgba => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color === "none" ? "transparent" : color;
      context.fillRect(0, 0, 1, 1);
      const data = context.getImageData(0, 0, 1, 1).data;
      return [data[0], data[1], data[2], data[3] / 255];
    };
    let opacity = 1;
    for (let parent: Element | null = label; parent; parent = parent.parentElement) {
      opacity *= Number(getComputedStyle(parent).opacity);
      if (parent.hasAttribute("data-atlas-world-map")) break;
    }
    const fill = rgba(css.fill); fill[3] *= Number(css.fillOpacity) * opacity;
    const stroke = rgba(css.stroke); stroke[3] *= Number(css.strokeOpacity) * opacity;
    return { text: label.textContent, fill, stroke, opacity, fontPixels: parseFloat(css.fontSize) * scale,
      strokePixels: parseFloat(css.strokeWidth) * scale, paintOrder: css.paintOrder,
      filter: css.filter, textShadow: css.textShadow };
  });
}

async function countryPaint(page: Page, entityId: string): Promise<Rgba> {
  return page.locator(`use[data-atlas-visual="${entityId}"]`).evaluate((element, id) => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const base = document.querySelector(`[data-atlas-base-geography="land"] use[href$="#atlas-${id.replace(/[^A-Za-z0-9_-]/g, "-")}"]`);
    const baseFill = base ? getComputedStyle(base).fill : "white";
    context.fillStyle = baseFill; context.fillRect(0, 0, 1, 1);
    const css = getComputedStyle(element);
    let opacity = Number(css.fillOpacity);
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      opacity *= Number(getComputedStyle(parent).opacity);
      if (parent.hasAttribute("data-atlas-world-map")) break;
    }
    context.globalAlpha = opacity;
    context.fillStyle = css.fill; context.fillRect(0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    return [pixel[0], pixel[1], pixel[2], pixel[3] / 255];
  }, entityId);
}

async function paintedFeaturesInViewport(layer: Locator) {
  return layer.locator("[data-atlas-map-feature] use").evaluateAll((features) => features.filter((feature) => {
    const element = feature as SVGGraphicsElement;
    const map = element.ownerSVGElement!.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    let geometry: DOMRect;
    try { geometry = element.getBBox(); } catch { return false; }
    const style = getComputedStyle(element);
    let opacity = 1;
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent);
      if (css.display === "none" || css.visibility === "hidden") return false;
      opacity *= Number(css.opacity);
      if (parent.hasAttribute("data-atlas-world-map")) break;
    }
    const hasPaint = (style.fill !== "none" && Number(style.fillOpacity) > 0)
      || (style.stroke !== "none" && parseFloat(style.strokeWidth) > 0 && Number(style.strokeOpacity) > 0);
    return hasPaint && opacity > 0.05 && geometry.width > 0 && geometry.height > 0
      && box.width > 0 && box.height > 0 && box.right > map.left && box.left < map.right
      && box.bottom > map.top && box.top < map.bottom;
  }).length);
}

test("country selection is matte ink and an outline, not glow or gradient paint", async ({ page }) => {
  await openAtlas(page, "?view=political&country=gab");
  await expect(page.getByRole("heading", { name: "Gabon", exact: true })).toBeVisible();
  const selected = page.locator('use[data-atlas-visual="country:GAB"]');
  await expect(selected).toHaveClass(/selected/);
  const styles = await paintEffects(selected);
  expect(styles.fill).not.toMatch(/url\(|gradient/i);
  expect(styles.fill).not.toBe("none");
  expect(styles.stroke).not.toBe("none");
  expect(styles.strokeWidth).toBeGreaterThan(0);
  expect(styles.backgroundImage).toBe("none");
  expect(styles.boxShadow).toBe("none");
  for (const ancestor of styles.ancestors) {
    expect(ancestor.filter).toBe("none");
    expect(ancestor.textShadow).toBe("none");
  }
  await selected.hover({ force: true });
  expect((await paintEffects(selected)).ancestors.every((entry) => entry.filter === "none")).toBe(true);
  const ocean = await paintEffects(page.locator('[data-atlas-map-group] > use[href$="#atlas-sphere"]'));
  expect(ocean.fill).not.toMatch(/url\(|gradient/i);
  expect(ocean.ancestors.every((entry) => entry.filter === "none")).toBe(true);
  // Camera decluttering may hide an unselected label, but the browser must
  // still give it the correct lens-dependent ink before it becomes visible.
  for (const code of ["CHN", "FRA", "GBR", "GAB"]) {
    const entityId = `country:${code}`;
    const style = await labelPaint(page.locator(`[data-atlas-label-entity="${entityId}"]`));
    const background = await countryPaint(page, entityId);
    const direct = contrast(composite(style.fill, background), background);
    if (direct >= 4.5) {
      expect(style.strokePixels, `${code}: adequate Political ink needs no keyline`).toBe(0);
    } else {
      expect(style.strokePixels, `${code}: low-contrast ink has an actual crisp keyline`).toBeGreaterThanOrEqual(0.75);
      expect(style.paintOrder).toMatch(/^stroke/);
      const keyline = composite(style.stroke, background);
      expect(contrast(composite(style.fill, keyline), keyline), `${code}: computed keyline contrast`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("country, city and river labels remain legible without a luminous halo", async ({ page }) => {
  await openAtlas(page, "?view=political&country=gab");
  await expect(page.getByRole("heading", { name: "Gabon", exact: true })).toBeVisible();
  const background = await countryPaint(page, "country:GAB");
  const labels = [
    { locator: page.locator('[data-atlas-label-entity="country:GAB"]'), minimum: 12 },
    { locator: page.locator('[data-atlas-label="city"]').filter({ hasText: /Libreville$/ }), minimum: 11 },
    { locator: page.locator('[data-atlas-label="physical"]').filter({ hasText: /Ogooué|Ngounie|Ivindo/ }).filter({ visible: true }).first(), minimum: 11 },
  ];
  for (const { locator, minimum } of labels) {
    await expect(locator).toBeVisible();
    const style = await labelPaint(locator);
    expect(style.fontPixels, `${style.text}: screen-space size`).toBeGreaterThanOrEqual(minimum - 0.1);
    expect(style.opacity, `${style.text}: labels cannot fade into the map`).toBeGreaterThanOrEqual(0.7);
    expect(style.filter).toBe("none");
    expect(style.textShadow).toBe("none");
    const directContrast = contrast(composite(style.fill, background), background);
    const keyline = composite(style.stroke, background);
    const keyedContrast = style.strokePixels >= 0.75 && style.paintOrder.startsWith("stroke")
      ? contrast(composite(style.fill, keyline), keyline) : 1;
    expect(Math.max(directContrast, keyedContrast), `${style.text}: nominal paint/keyline contrast`).toBeGreaterThanOrEqual(4.5);
  }
  const country = labels[0].locator;
  const before = await labelPaint(country);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(country).toBeVisible();
  const after = await labelPaint(country);
  expect(after.fontPixels / before.fontPixels).toBeCloseTo(1, 1);
});

for (const [id, name] of VIEWS) {
  test(`${name} retains real relief, river and lake detail`, async ({ page }) => {
    test.setTimeout(45_000);
    await openAtlas(page, `?view=${id}&country=egy`);
    await expect(page.getByRole("heading", { name: "Egypt", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close Egypt", exact: true }).click();
    await expect(page.getByRole("button", { name: `Choose view: ${name}`, exact: true })).toBeVisible();
    for (const layerId of ["major-rivers", "major-lakes"]) {
      const layer = page.locator(`[data-atlas-layer="${layerId}"]`);
      await expect(layer).toHaveAttribute("data-atlas-layer-active", "true");
      await expect.poll(() => paintedFeaturesInViewport(layer)).toBeGreaterThan(0);
      const filters = await layer.locator("use[data-atlas-geography-href]").evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).filter));
      expect(filters.every((filter) => filter === "none"), `${layerId}: geographic ink has no glow`).toBe(true);
    }
    const relief = page.locator('[data-atlas-layer="physical-relief"]');
    await expect(relief).toHaveAttribute("data-atlas-layer-active", "true");
    await expect(relief).toHaveCSS("clip-path", /#atlas-physical-land-clip/);
    const landClip = page.locator('clipPath[id="atlas-physical-land-clip"]');
    await expect(landClip).toHaveCount(1);
    await expect(landClip).toHaveAttribute("clipPathUnits", "userSpaceOnUse");
    await expect(landClip.locator('use[href*="#atlas-country-"]')).toHaveCount(242);
    await expect.poll(() => relief.evaluate((element) => {
      const css = getComputedStyle(element);
      return css.display !== "none" && css.visibility !== "hidden" && Number(css.opacity) > 0;
    })).toBe(true);
    // Source-detail is a new resampling of the pinned relief evidence, not new
    // population information. Scope by layer now that both fields use pyramids.
    await expect(relief.locator("[data-atlas-raster-level]")).toHaveAttribute("data-atlas-raster-level", "source-detail");
    const loaded = relief.locator('[data-atlas-raster-tile][visibility="visible"]');
    await expect.poll(() => loaded.count(), { timeout: 20_000 }).toBeGreaterThan(0);
    const asset = await loaded.first().getAttribute("href");
    expect(asset).toBeTruthy();
    expect(await page.evaluate((href) => new Promise<boolean>((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image.naturalWidth > 1 && image.naturalHeight > 1);
      image.onerror = () => resolve(false);
      image.src = href!;
    }), asset)).toBe(true);
    await expect(relief.locator("[data-atlas-raster-level]")).toHaveAttribute("data-atlas-raster-fallback", "false");
    if (id === "where-people-live") {
      const density = page.locator('[data-atlas-layer="population-density-2025"]');
      await expect(density).toHaveAttribute("data-atlas-layer-active", "true");
      await expect.poll(() => density.locator('[data-atlas-raster-tile][visibility="visible"]').count()).toBeGreaterThan(0);
    }
  });
}

test("the visual change preserves search, changing lens, selection and history", async ({ page }) => {
  await openAtlas(page, "?view=political");
  await chooseCountry(page, "Zimbabwe");
  await chooseView(page, "Religion");
  await expect(page.getByLabel("Religious composition", { exact: true })).toContainText("85.3%");
  await chooseCountry(page, "Gabon");
  await expect(page.getByLabel("Religious composition", { exact: true })).toContainText("80.2%");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Zimbabwe", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose view: Religion", exact: true })).toBeVisible();
  await expect(page.getByLabel("Religious composition", { exact: true })).toContainText("85.3%");
});
