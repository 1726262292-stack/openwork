export type PaperAvatarVariant = "extension" | "workspace";

type Palette = readonly [string, string, string, string, string];

type PaperAvatarStyle = {
  backgroundColor: string;
  backgroundImage: string;
  backgroundPosition: string;
  backgroundSize: string;
};

const extensionPalettes: readonly Palette[] = [
  ["#e0eaff", "#241d9a", "#f75092", "#9f50d3", "#5cf5d9"],
  ["#a8f976", "#5cf5d9", "#8261fa", "#14e1bc", "#111827"],
  ["#ffe29f", "#ffa99f", "#ff719a", "#6c5ce7", "#35d8c0"],
  ["#b8fff9", "#85f4ff", "#8b5cf6", "#111827", "#f75092"],
  ["#fff2cc", "#ff6b35", "#004e89", "#1a659e", "#ffb703"],
  ["#f5d0fe", "#7c3aed", "#06b6d4", "#f43f5e", "#facc15"],
];

const workspacePalettes: readonly Palette[] = [
  ["#7c3cff", "#00e5ff", "#ff2f92", "#ffb000", "#12ff8f"],
  ["#1227ff", "#00ffd5", "#ff5c00", "#fff200", "#9d4edd"],
  ["#ff006e", "#3a86ff", "#8338ec", "#ffbe0b", "#06ffa5"],
  ["#00c2ff", "#001aff", "#ff4ecd", "#b8ff2c", "#ff7a00"],
  ["#14f195", "#9945ff", "#00d1ff", "#ff2d55", "#ffd60a"],
  ["#ff3d00", "#ffd500", "#00f5d4", "#7209b7", "#f72585"],
  ["#39ff14", "#00bbf9", "#fee440", "#9b5de5", "#f15bb5"],
  ["#4cc9f0", "#4361ee", "#f72585", "#b5179e", "#80ffdb"],
];

const styleCache = new Map<string, PaperAvatarStyle>();

export function getPaperAvatarStyle(seed: string, variant: PaperAvatarVariant): PaperAvatarStyle {
  const cacheKey = `${variant}:${seed.trim() || variant}`;
  const cached = styleCache.get(cacheKey);
  if (cached) return cached;

  const palette = paletteForSeed(seed, variant);
  const style = {
    backgroundColor: palette[0],
    backgroundImage: svgToCssUrl(generatePaperAvatarSvg(seed, variant, palette)),
    backgroundPosition: "center",
    backgroundSize: "cover",
  };

  styleCache.set(cacheKey, style);
  return style;
}

function paletteForSeed(seed: string, variant: PaperAvatarVariant): Palette {
  const palettes = variant === "workspace" ? workspacePalettes : extensionPalettes;
  return palettes[hashSeed(seed, `${variant}:palette`) % palettes.length];
}

function generatePaperAvatarSvg(seed: string, variant: PaperAvatarVariant, palette: Palette): string {
  const random = createRandom(seed, variant);
  const blobCount = variant === "workspace" ? 6 : 5;
  const blobGradients: string[] = [];
  const blobLayers: string[] = [];
  const colorPop = variant === "workspace" ? 1 : 0.86;
  const grainOpacity = variant === "workspace" ? 0.52 : 0.42;

  for (let index = 0; index < blobCount; index += 1) {
    const color = palette[(index + 1) % palette.length];
    const cx = round(-10 + random() * 116, 1);
    const cy = round(-10 + random() * 116, 1);
    const radius = round(42 + random() * 44, 1);
    const innerOpacity = round((0.66 + random() * 0.3) * colorPop, 2);
    const middleOpacity = round((0.28 + random() * 0.24) * colorPop, 2);

    blobGradients.push(
      `<radialGradient id="blob${index}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${radius}">` +
        `<stop offset="0%" stop-color="${color}" stop-opacity="${innerOpacity}"/>` +
        `<stop offset="58%" stop-color="${color}" stop-opacity="${middleOpacity}"/>` +
        `<stop offset="100%" stop-color="${color}" stop-opacity="0"/>` +
      `</radialGradient>`,
    );
    blobLayers.push(`<rect width="96" height="96" fill="url(#blob${index})"/>`);
  }

  const grainRotation = Math.round(random() * 180);
  const highlightPath = buildRibbonPath(random, 10, 46);
  const shadowPath = buildRibbonPath(random, 34, 74);
  const strokePath = buildStrokePath(random);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">` +
      `<defs>` +
        `<linearGradient id="base" x1="${round(random() * 40, 1)}%" y1="0%" x2="${round(60 + random() * 40, 1)}%" y2="100%">` +
          `<stop offset="0%" stop-color="${palette[0]}"/>` +
          `<stop offset="52%" stop-color="${palette[3]}"/>` +
          `<stop offset="100%" stop-color="${palette[1]}"/>` +
        `</linearGradient>` +
        blobGradients.join("") +
        `<pattern id="grain" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(${grainRotation})">` +
          `<path d="M0 .5H6M.5 0V6" stroke="#fff" stroke-opacity=".09" stroke-width=".45"/>` +
          `<path d="M0 5.5H6" stroke="#000" stroke-opacity=".07" stroke-width=".55"/>` +
          `<circle cx="${round(0.8 + random() * 4.4, 1)}" cy="${round(0.8 + random() * 4.4, 1)}" r=".42" fill="#fff" fill-opacity=".16"/>` +
        `</pattern>` +
      `</defs>` +
      `<rect width="96" height="96" fill="url(#base)"/>` +
      blobLayers.join("") +
      `<path d="${highlightPath}" fill="#fff" opacity="${variant === "workspace" ? ".18" : ".14"}"/>` +
      `<path d="${shadowPath}" fill="#000" opacity="${variant === "workspace" ? ".16" : ".12"}"/>` +
      `<path d="${strokePath}" fill="none" stroke="#fff" stroke-opacity="${variant === "workspace" ? ".22" : ".18"}" stroke-width="7" stroke-linecap="round"/>` +
      `<rect width="96" height="96" fill="url(#grain)" opacity="${grainOpacity}"/>` +
      `<rect width="96" height="96" fill="#000" opacity=".04"/>` +
    `</svg>`
  );
}

function buildRibbonPath(random: () => number, minY: number, maxY: number): string {
  const startY = round(minY + random() * (maxY - minY), 1);
  const midY = round(minY + random() * (maxY - minY), 1);
  const endY = round(minY + random() * (maxY - minY), 1);
  const tailY = round(96 + random() * 20, 1);

  return `M -14 ${startY} C ${round(14 + random() * 18, 1)} ${round(startY - 18 + random() * 36, 1)} ${round(44 + random() * 18, 1)} ${midY} 110 ${endY} L 110 ${tailY} L -14 ${tailY} Z`;
}

function buildStrokePath(random: () => number): string {
  const startY = round(18 + random() * 58, 1);
  const endY = round(18 + random() * 58, 1);

  return `M -10 ${startY} C ${round(18 + random() * 22, 1)} ${round(random() * 96, 1)} ${round(54 + random() * 18, 1)} ${round(random() * 96, 1)} 106 ${endY}`;
}

function svgToCssUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function createRandom(seed: string, salt: string) {
  let state = hashSeed(seed, salt) || 1;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function hashSeed(seed: string, salt: string): number {
  const value = `${salt}:${seed.trim() || salt}`;
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }

  return hash >>> 0;
}

function round(value: number, decimals: number): number {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}
