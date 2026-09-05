/** Reading ink, not a data classification. Choose against the authored area
 * paint; raster views still need a crisp keyline because pixels vary locally. */
export function atlasLabelInk(color: string, opacity = 1) {
  const match = /^#([\da-f]{6})$/i.exec(color);
  const rgb = match ? match[1].match(/../g)!.map((value) => parseInt(value, 16)) : [177, 180, 154];
  const base = [177, 180, 154];
  const luminance = (channels: number[]) => channels.map((value) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const background = luminance(rgb.map((value, index) => value * opacity + base[index] * (1 - opacity)));
  const dark = luminance([21, 40, 32]);
  const light = luminance([243, 243, 231]);
  const contrast = (ink: number) => (Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05);
  const needsKeyline = Math.max(contrast(dark), contrast(light)) < 4.5;
  return contrast(dark) >= contrast(light)
    ? { fill: "#152820", keyline: "#f3f3e7", needsKeyline }
    : { fill: "#f3f3e7", keyline: "#152820", needsKeyline };
}
