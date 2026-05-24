export type PaperAvatarVariant = "extension" | "workspace";

type Palette = readonly [string, string, string, string, string];

type PaperAvatarStyle = {
  backgroundColor: string;
  backgroundImage: string;
  backgroundPosition: string;
  backgroundSize: string;
};

const extensionPalettes: readonly Palette[] = [
  ["#17115f", "#38e7ff", "#ff4fa3", "#9f62ff", "#fff06a"],
  ["#043f3a", "#5cffb0", "#7c5cff", "#1ad8ff", "#ffca5f"],
  ["#4f1c08", "#ffb44d", "#ff4f88", "#6754ff", "#3cffd0"],
  ["#101447", "#31d4ff", "#9566ff", "#f66fb3", "#a8ff5e"],
  ["#082f49", "#45d5ff", "#ff7a35", "#ffcf4d", "#42ffc6"],
  ["#2e145f", "#c569ff", "#1ee8ff", "#ff5378", "#f8ec5f"],
];

const workspacePalettes: readonly Palette[] = [
  ["#170057", "#00eaff", "#ff2fb2", "#7cff6b", "#ffd23f"],
  ["#06139a", "#22fff0", "#ff6a2f", "#fff63d", "#b15cff"],
  ["#4d0038", "#3a9cff", "#ff2f86", "#8f5cff", "#39ffbd"],
  ["#001f5c", "#00c8ff", "#ff62dd", "#c2ff33", "#ff8a2f"],
  ["#00382a", "#20ff9a", "#9d5cff", "#1ee8ff", "#ff4d6d"],
  ["#5c1800", "#ffd23f", "#24ffe1", "#8a3dff", "#ff4fa3"],
  ["#1b4d00", "#7cff4d", "#1ec9ff", "#ffe84d", "#f05cff"],
  ["#082454", "#61d8ff", "#5f75ff", "#ff4d9d", "#94ffe0"],
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
  const glowCount = variant === "workspace" ? 7 : 6;
  const glowGradients: string[] = [];
  const glowLayers: string[] = [];
  const grainOpacity = variant === "workspace" ? 0.42 : 0.34;

  for (let index = 0; index < glowCount; index += 1) {
    const color = palette[(index + (variant === "workspace" ? 2 : 1)) % palette.length];
    const cx = round(-12 + random() * 120, 1);
    const cy = round(-12 + random() * 120, 1);
    const radius = round(34 + random() * 42, 1);
    const coreOpacity = round(0.76 + random() * 0.18, 2);
    const bloomOpacity = round(0.36 + random() * 0.18, 2);

    glowGradients.push(
      `<radialGradient id="glow${index}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${radius}">` +
        `<stop offset="0%" stop-color="${color}" stop-opacity="${coreOpacity}"/>` +
        `<stop offset="38%" stop-color="${color}" stop-opacity="${bloomOpacity}"/>` +
        `<stop offset="72%" stop-color="${color}" stop-opacity=".1"/>` +
        `<stop offset="100%" stop-color="${color}" stop-opacity="0"/>` +
      `</radialGradient>`,
    );
    glowLayers.push(`<rect width="96" height="96" fill="url(#glow${index})"/>`);
  }

  const hotSpots = buildHotSpots(random, variant, palette);
  const streaks = buildGlowStreaks(random, variant, palette);
  const fibers = buildPaperFibers(random, variant);
  const grain = buildPaperGrain(random, variant);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">` +
      `<defs>` +
        `<linearGradient id="base" x1="${round(random() * 40, 1)}%" y1="0%" x2="${round(60 + random() * 40, 1)}%" y2="100%">` +
          `<stop offset="0%" stop-color="${palette[0]}"/>` +
          `<stop offset="54%" stop-color="${palette[3]}"/>` +
          `<stop offset="100%" stop-color="#050816"/>` +
        `</linearGradient>` +
        `<radialGradient id="vignette" cx="50%" cy="42%" r="78%">` +
          `<stop offset="45%" stop-color="#fff" stop-opacity="0"/>` +
          `<stop offset="100%" stop-color="#020617" stop-opacity=".34"/>` +
        `</radialGradient>` +
        glowGradients.join("") +
      `</defs>` +
      `<rect width="96" height="96" fill="url(#base)"/>` +
      glowLayers.join("") +
      streaks +
      hotSpots +
      `<rect width="96" height="96" fill="url(#vignette)"/>` +
      `<g opacity="${grainOpacity}">` + fibers + grain + `</g>` +
      `<rect width="96" height="96" fill="#fff" opacity="${variant === "workspace" ? ".015" : ".025"}"/>` +
    `</svg>`
  );
}

function buildHotSpots(random: () => number, variant: PaperAvatarVariant, palette: Palette): string {
  const count = variant === "workspace" ? 4 : 3;
  const spots: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const color = palette[(index + 1 + Math.floor(random() * (palette.length - 1))) % palette.length];
    const cx = round(12 + random() * 72, 1);
    const cy = round(12 + random() * 72, 1);
    const radius = round(2.2 + random() * 5.8, 1);

    spots.push(
      `<circle cx="${cx}" cy="${cy}" r="${round(radius * 3.5, 1)}" fill="${color}" opacity=".12"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${round(radius * 1.55, 1)}" fill="${color}" opacity=".42"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="#fff" opacity=".32"/>`,
    );
  }

  return spots.join("");
}

function buildGlowStreaks(random: () => number, variant: PaperAvatarVariant, palette: Palette): string {
  const count = variant === "workspace" ? 3 : 2;
  const streaks: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const startY = round(14 + random() * 70, 1);
    const controlY = round(8 + random() * 80, 1);
    const endY = round(14 + random() * 70, 1);
    const color = palette[(index + 1 + Math.floor(random() * 4)) % palette.length];
    const opacity = round(0.14 + random() * 0.12, 3);
    const width = round(7 + random() * 12, 1);

    streaks.push(
      `<path d="M -20 ${startY} C ${round(16 + random() * 22, 1)} ${controlY} ${round(54 + random() * 18, 1)} ${round(96 - controlY, 1)} 116 ${endY}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${width}" stroke-linecap="round"/>` +
        `<path d="M -18 ${round(startY + random() * 8 - 4, 1)} C ${round(18 + random() * 20, 1)} ${round(controlY + random() * 10 - 5, 1)} ${round(54 + random() * 18, 1)} ${round(96 - controlY + random() * 10 - 5, 1)} 114 ${round(endY + random() * 8 - 4, 1)}" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="${round(width * 0.34, 1)}" stroke-linecap="round"/>`,
    );
  }

  return streaks.join("");
}

function buildPaperFibers(random: () => number, variant: PaperAvatarVariant): string {
  const count = variant === "workspace" ? 14 : 10;
  const fibers: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const startX = round(-8 + random() * 98, 1);
    const startY = round(random() * 96, 1);
    const length = round(10 + random() * 34, 1);
    const drift = round(-7 + random() * 14, 1);
    const color = random() > 0.2 ? "#fff" : "#020617";
    const opacity = color === "#fff" ? round(0.035 + random() * 0.05, 3) : round(0.02 + random() * 0.035, 3);
    const width = round(0.22 + random() * 0.46, 2);

    fibers.push(
      `<path d="M ${startX} ${startY} C ${round(startX + length * 0.4, 1)} ${round(startY + drift, 1)} ${round(startX + length * 0.68, 1)} ${round(startY - drift, 1)} ${round(startX + length, 1)} ${round(startY + drift * 0.35, 1)}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${width}" stroke-linecap="round"/>`,
    );
  }

  return fibers.join("");
}

function buildPaperGrain(random: () => number, variant: PaperAvatarVariant): string {
  const count = variant === "workspace" ? 64 : 52;
  const dots: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const color = random() > 0.24 ? "#fff" : "#020617";
    const opacity = color === "#fff" ? round(0.04 + random() * 0.1, 3) : round(0.025 + random() * 0.04, 3);
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
