function clamp(value: number, min = 0, max = 255) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function mix(a: number[], b: number[], amount: number) {
  return a.map((value, index) => clamp(value * (1 - amount) + b[index] * amount));
}

function rgb(value: number[]) {
  return `rgb(${value.map(channel => clamp(channel)).join(", ")})`;
}

function brightness(value: number[]) {
  return value[0] * .299 + value[1] * .587 + value[2] * .114;
}

function saturation(value: number[]) {
  const max = Math.max(...value);
  const min = Math.min(...value);
  return max - min;
}

export function applyCoverPalette(image: HTMLImageElement) {
  const card = image.closest<HTMLElement>(".bookCard");
  if (!card || card.dataset.paletteReady === "true" || !image.naturalWidth || !image.naturalHeight) return;

  try {
    const canvas = document.createElement("canvas");
    const width = 28;
    const height = Math.max(1, Math.round(width * image.naturalHeight / image.naturalWidth));
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(image, 0, 0, width, height);

    const pixels = context.getImageData(0, 0, width, height).data;
    let accent = [190, 145, 55];
    let accentScore = -1;
    let total = [0, 0, 0];
    let count = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] < 180) continue;
      const color = [pixels[index], pixels[index + 1], pixels[index + 2]];
      const light = brightness(color);
      if (light < 18 || light > 242) continue;
      const sat = saturation(color);
      const score = sat * 1.8 + Math.abs(light - 126) * .25;
      total = total.map((value, channel) => value + color[channel]);
      count += 1;
      if (score > accentScore) {
        accentScore = score;
        accent = color;
      }
    }

    const average = count ? total.map(value => value / count) : accent;
    const panel = mix(average, [8, 13, 18], .72);
    const panel2 = mix(accent, [6, 9, 13], .7);
    const text = brightness(panel) > 125 ? [24, 18, 14] : [248, 244, 235];

    card.style.setProperty("--cover-accent", rgb(accent));
    card.style.setProperty("--cover-accent-rgb", accent.map(channel => clamp(channel)).join(", "));
    card.style.setProperty("--cover-panel", rgb(panel));
    card.style.setProperty("--cover-panel-2", rgb(panel2));
    card.style.setProperty("--cover-text", rgb(text));
    card.dataset.paletteReady = "true";
  } catch {
    card.dataset.paletteReady = "failed";
  }
}
