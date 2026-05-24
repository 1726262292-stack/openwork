export type PaperAvatarVariant = "extension" | "workspace";

type Palette = readonly [string, string, string, string, string];

type PaperAvatarStyle = {
  backgroundColor: string;
  backgroundImage: string;
  backgroundPosition: string;
  backgroundSize: string;
};

const extensionPalettes: readonly Palette[] = [
  ["#edf2ff", "#2f2aa0", "#f56aa0", "#9f62d1", "#5eead4"],
  ["#eaffd5", "#138a72", "#7c5cff", "#43e6bd", "#203063"],
  ["#fff1c7", "#ee7b58", "#f25f92", "#6754d9", "#33c7b7"],
  ["#dcfffb", "#22b8e6", "#805ad5", "#1d1f33", "#f66fb3"],
  ["#fff3dd", "#d96b2b", "#1b6d9a", "#31a7c9", "#f8c64e"],
  ["#f8ddff", "#7f4ce3", "#15b6d6", "#e45175", "#f4d35e"],
];

const workspacePalettes: readonly Palette[] = [
  ["#6d35ff", "#00d5ff", "#ff4fa3", "#ffbd35", "#35f2a5"],
  ["#2347ff", "#20e6c8", "#ff7a3d", "#f7e34a", "#9d61ff"],
  ["#f72585", "#3a86ff", "#7b4dff", "#ffbe3d", "#2ee6ad"],
  ["#00b7ff", "#2735d9", "#eb5ed3", "#b8f24a", "#ff8a35"],
  ["#21d995", "#9157ff", "#1ec9f0", "#ff4d6d", "#ffd166"],
  ["#f05a28", "#ffd23f", "#21d9c3", "#6d35ba", "#e94d91"],
  ["#78e44d", "#1cb8e8", "#f8dc54", "#9561d9", "#e862b6"],
  ["#4cc9f0", "#4965e8", "#ef4f91", "#a23ab8", "#86f0d3"],
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
  const blobCount = variant === "workspace" ? 8 : 7;
  const blobGradients: string[] = [];
  const blobLayers: string[] = [];
  const grainOpacity = variant === "workspace" ? 0.58 : 0.46;

  for (let index = 0; index < blobCount; index += 1) {
    const color = palette[(index + (variant === "workspace" ? 2 : 1)) % palette.length];
    const cx = round(-18 + random() * 132, 1);
    const cy = round(-18 + random() * 132, 1);
    const radius = round(46 + random() * 48, 1);
    const innerOpacity = round(0.48 + random() * 0.22, 2);
    const middleOpacity = round(0.2 + random() * 0.16, 2);

    blobGradients.push(
      `<radialGradient id="blob${index}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${radius}">` +
        `<stop offset="0%" stop-color="${color}" stop-opacity="${innerOpacity}"/>` +
        `<stop offset="48%" stop-color="${color}" stop-opacity="${middleOpacity}"/>` +
        `<stop offset="100%" stop-color="${color}" stop-opacity="0"/>` +
      `</radialGradient>`,
    );
    blobLayers.push(`<rect width="96" height="96" fill="url(#blob${index})"/>`);
  }

  const streaks = buildSoftStreaks(random, variant);
  const fibers = buildPaperFibers(random, variant);
  const grain = buildPaperGrain(random, variant);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">` +
      `<defs>` +
        `<linearGradient id="base" x1="${round(random() * 40, 1)}%" y1="0%" x2="${round(60 + random() * 40, 1)}%" y2="100%">` +
          `<stop offset="0%" stop-color="${palette[0]}"/>` +
          `<stop offset="48%" stop-color="${palette[3]}"/>` +
          `<stop offset="100%" stop-color="${palette[1]}"/>` +
        `</linearGradient>` +
        `<radialGradient id="vignette" cx="50%" cy="42%" r="78%">` +
          `<stop offset="52%" stop-color="#fff" stop-opacity="0"/>` +
          `<stop offset="100%" stop-color="#111827" stop-opacity=".2"/>` +
        `</radialGradient>` +
        blobGradients.join("") +
      `</defs>` +
      `<rect width="96" height="96" fill="url(#base)"/>` +
      blobLayers.join("") +
      streaks +
      `<rect width="96" height="96" fill="url(#vignette)"/>` +
      `<g opacity="${grainOpacity}">` + fibers + grain + `</g>` +
      `<rect width="96" height="96" fill="#fff" opacity="${variant === "workspace" ? ".05" : ".07"}"/>` +
    `</svg>`
  );
}

function buildSoftStreaks(random: () => number, variant: PaperAvatarVariant): string {
  const count = variant === "workspace" ? 3 : 2;
  const streaks: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const startY = round(14 + random() * 70, 1);
    const controlY = round(8 + random() * 80, 1);
    const endY = round(14 + random() * 70, 1);
    const color = random() > 0.42 ? "#fff" : "#111827";
    const opacity = round(0.055 + random() * 0.07, 3);
    const width = round(12 + random() * 18, 1);

    streaks.push(
      `<path d="M -20 ${startY} C ${round(16 + random() * 22, 1)} ${controlY} ${round(54 + random() * 18, 1)} ${round(96 - controlY, 1)} 116 ${endY}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${width}" stroke-linecap="round"/>`,
    );
  }

  return streaks.join("");
}

function buildPaperFibers(random: () => number, variant: PaperAvatarVariant): string {
  const count = variant === "workspace" ? 18 : 14;
  const fibers: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const startX = round(-8 + random() * 98, 1);
    const startY = round(random() * 96, 1);
    const length = round(10 + random() * 34, 1);
    const drift = round(-7 + random() * 14, 1);
    const color = random() > 0.5 ? "#fff" : "#111827";
    const opacity = round(0.035 + random() * 0.06, 3);
    const width = round(0.22 + random() * 0.46, 2);

    fibers.push(
      `<path d="M ${startX} ${startY} C ${round(startX + length * 0.4, 1)} ${round(startY + drift, 1)} ${round(startX + length * 0.68, 1)} ${round(startY - drift, 1)} ${round(startX + length, 1)} ${round(startY + drift * 0.35, 1)}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${width}" stroke-linecap="round"/>`,
    );
  }

  return fibers.join("");
}

function buildPaperGrain(random: () => number, variant: PaperAvatarVariant): string {
  const count = variant === "workspace" ? 84 : 68;
  const dots: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const color = random() > 0.47 ? "#fff" : "#111827";
    const opacity = round(0.035 + random() * 0.095, 3);
    const radius = round(0.12 + random() * 0.32, 2);

    dots.push(
      `<circle cx="${round(random() * 96, 1)}" cy="${round(random() * 96, 1)}" r="${radius}" fill="${color}" opacity="${opacity}"/>`,
    );
  }

  return dots.join("");
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
