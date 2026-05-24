export type PaperAvatarVariant = "extension" | "workspace";

type PaperAvatarStyle = {
  backgroundColor: string;
  backgroundImage: string;
  backgroundPosition: string;
  backgroundSize: string;
};

type Palette = {
  background: string;
  base: string;
  primary: string;
  secondary: string;
  tertiary: string;
  accent: string;
  highlight: string;
  shadow: string;
};

type SvgLayerSet = {
  defs: string;
  layers: string;
};

const styleCache = new Map<string, PaperAvatarStyle>();

export function getPaperAvatarStyle(seed: string, variant: PaperAvatarVariant): PaperAvatarStyle {
  const cacheKey = `${variant}:${seed.trim() || variant}`;
  const cached = styleCache.get(cacheKey);
  if (cached) return cached;

  const palette = createPalette(seed, variant);
  const style = {
    backgroundColor: palette.background,
    backgroundImage: svgToCssUrl(generatePaperAvatarSvg(seed, variant, palette)),
    backgroundPosition: "center",
    backgroundSize: "cover",
  };

  styleCache.set(cacheKey, style);
  return style;
}

function createPalette(seed: string, variant: PaperAvatarVariant): Palette {
  const hue = hashSeed(seed, `${variant}:hue`) % 360;
  const vivid = variant === "workspace";
  const saturation = vivid ? 98 : 92;
  const glowLight = vivid ? 60 : 62;

  return {
    background: hsl(hue + 224, 78, vivid ? 9 : 12),
    base: hsl(hue + 252, 84, vivid ? 13 : 16),
    primary: hsl(hue, saturation, glowLight),
    secondary: hsl(hue + 76, saturation, vivid ? 57 : 60),
    tertiary: hsl(hue + 154, vivid ? 94 : 88, vivid ? 55 : 58),
    accent: hsl(hue + 292, vivid ? 96 : 90, vivid ? 64 : 66),
    highlight: "#ffffff",
    shadow: "#020617",
  };
}

function generatePaperAvatarSvg(seed: string, variant: PaperAvatarVariant, palette: Palette): string {
  const random = createRandom(seed, `${variant}:svg`);
  const glows = buildGlowLayers(random, variant, palette);
  const ribbons = buildAuroraRibbons(random, variant, palette);
  const grain = buildGrain(random, variant, palette);
  const motifIndex = hashSeed(seed, `${variant}:motif`) % 3;
  const motif = motifIndex === 0
    ? buildOrbitalMotif(random, variant, palette)
    : motifIndex === 1
      ? buildPrismMotif(random, variant, palette)
      : buildPixelMotif(random, variant, palette);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">` +
      `<defs>` +
        `<linearGradient id="base" x1="0" y1="0" x2="1" y2="1">` +
          `<stop offset="0" stop-color="${palette.base}"/>` +
          `<stop offset=".58" stop-color="${palette.background}"/>` +
          `<stop offset="1" stop-color="${palette.shadow}"/>` +
        `</linearGradient>` +
        `<radialGradient id="centerLift" cx="50%" cy="44%" r="70%">` +
          `<stop offset="0" stop-color="${palette.highlight}" stop-opacity=".12"/>` +
          `<stop offset=".52" stop-color="${palette.highlight}" stop-opacity="0"/>` +
          `<stop offset="1" stop-color="${palette.shadow}" stop-opacity=".38"/>` +
        `</radialGradient>` +
        glows.defs +
        ribbons.defs +
      `</defs>` +
      `<rect width="96" height="96" fill="url(#base)"/>` +
      `<g style="mix-blend-mode:screen">` + glows.layers + ribbons.layers + motif + `</g>` +
      `<rect width="96" height="96" fill="url(#centerLift)"/>` +
      grain +
      `<path d="M0 0H96V96H0Z" fill="none" stroke="${palette.highlight}" stroke-opacity=".12" stroke-width="2"/>` +
    `</svg>`
  );
}

function buildGlowLayers(random: () => number, variant: PaperAvatarVariant, palette: Palette): SvgLayerSet {
  const colors = [palette.primary, palette.secondary, palette.tertiary, palette.accent];
  const count = variant === "workspace" ? 6 : 5;
  const defs: string[] = [];
  const layers: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const color = colors[index % colors.length];
    const cx = round(-8 + random() * 112, 1);
    const cy = round(-8 + random() * 112, 1);
    const radius = round(30 + random() * 38, 1);
    const coreOpacity = round((variant === "workspace" ? 0.82 : 0.72) + random() * 0.14, 2);
    const bloomOpacity = round((variant === "workspace" ? 0.32 : 0.26) + random() * 0.16, 2);

    defs.push(
      `<radialGradient id="glow${index}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${radius}">` +
        `<stop offset="0" stop-color="${color}" stop-opacity="${coreOpacity}"/>` +
        `<stop offset=".34" stop-color="${color}" stop-opacity="${bloomOpacity}"/>` +
        `<stop offset=".72" stop-color="${color}" stop-opacity=".08"/>` +
        `<stop offset="1" stop-color="${color}" stop-opacity="0"/>` +
      `</radialGradient>`,
    );

    layers.push(`<rect width="96" height="96" fill="url(#glow${index})"/>`);
  }

  return { defs: defs.join(""), layers: layers.join("") };
}

function buildAuroraRibbons(random: () => number, variant: PaperAvatarVariant, palette: Palette): SvgLayerSet {
  const colors = [palette.primary, palette.secondary, palette.tertiary, palette.accent];
  const count = variant === "workspace" ? 3 : 2;
  const defs: string[] = [];
  const layers: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const first = colors[(index + 1) % colors.length];
    const second = colors[(index + 2) % colors.length];
    const startY = round(10 + random() * 72, 1);
    const endY = round(10 + random() * 72, 1);
    const controlA = round(4 + random() * 88, 1);
    const controlB = round(4 + random() * 88, 1);
    const width = round((variant === "workspace" ? 10 : 8) + random() * 9, 1);
    const opacity = round((variant === "workspace" ? 0.24 : 0.18) + random() * 0.13, 2);
    const path = `M -18 ${startY} C 18 ${controlA} 54 ${controlB} 114 ${endY}`;

    defs.push(
      `<linearGradient id="ribbon${index}" x1="0" y1="0" x2="96" y2="96" gradientUnits="userSpaceOnUse">` +
        `<stop offset="0" stop-color="${first}"/>` +
        `<stop offset=".54" stop-color="${palette.highlight}"/>` +
        `<stop offset="1" stop-color="${second}"/>` +
      `</linearGradient>`,
    );

    layers.push(
      `<path d="${path}" fill="none" stroke="url(#ribbon${index})" stroke-opacity="${opacity}" stroke-width="${width}" stroke-linecap="round"/>` +
        `<path d="${path}" fill="none" stroke="${palette.highlight}" stroke-opacity=".14" stroke-width="${round(width * 0.18, 1)}" stroke-linecap="round"/>`,
    );
  }

  return { defs: defs.join(""), layers: layers.join("") };
}

function buildOrbitalMotif(random: () => number, variant: PaperAvatarVariant, palette: Palette): string {
  const opacity = variant === "workspace" ? 0.36 : 0.28;
  const rotation = Math.round(random() * 90) - 45;
  const secondRotation = rotation + 58 + Math.round(random() * 24);

  return (
    `<ellipse cx="48" cy="48" rx="${round(23 + random() * 9, 1)}" ry="${round(9 + random() * 8, 1)}" fill="none" stroke="${palette.highlight}" stroke-opacity="${opacity}" stroke-width="1.4" transform="rotate(${rotation} 48 48)"/>` +
    `<ellipse cx="48" cy="48" rx="${round(28 + random() * 10, 1)}" ry="${round(12 + random() * 10, 1)}" fill="none" stroke="${palette.secondary}" stroke-opacity="${round(opacity * 0.62, 2)}" stroke-width="1.1" transform="rotate(${secondRotation} 48 48)"/>` +
    `<circle cx="${round(29 + random() * 38, 1)}" cy="${round(27 + random() * 42, 1)}" r="${round(2.6 + random() * 3, 1)}" fill="${palette.highlight}" opacity=".34"/>`
  );
}

function buildPrismMotif(random: () => number, variant: PaperAvatarVariant, palette: Palette): string {
  const opacity = variant === "workspace" ? 0.3 : 0.22;
  const shift = round(random() * 18 - 9, 1);

  return (
    `<path d="M${round(8 + shift, 1)} 86 L${round(40 + shift, 1)} 18 L${round(76 + shift, 1)} 86 Z" fill="${palette.highlight}" opacity="${round(opacity * 0.56, 2)}"/>` +
    `<path d="M${round(40 + shift, 1)} 18 L${round(76 + shift, 1)} 86 L${round(52 + shift, 1)} 68 Z" fill="${palette.primary}" opacity="${opacity}"/>` +
    `<path d="M${round(8 + shift, 1)} 86 L${round(40 + shift, 1)} 18 L${round(52 + shift, 1)} 68 Z" fill="${palette.tertiary}" opacity="${round(opacity * 0.86, 2)}"/>`
  );
}

function buildPixelMotif(random: () => number, variant: PaperAvatarVariant, palette: Palette): string {
  const grid = variant === "workspace" ? 5 : 4;
  const cell = 8;
  const start = 48 - (grid * cell) / 2;
  const colors = [palette.highlight, palette.primary, palette.secondary, palette.tertiary, palette.accent];
  const pixels: string[] = [];

  for (let y = 0; y < grid; y += 1) {
    for (let x = 0; x < Math.ceil(grid / 2); x += 1) {
      if (random() < 0.5) continue;

      const color = colors[(x + y + Math.floor(random() * colors.length)) % colors.length];
      const size = round(2.4 + random() * 2.8, 1);
      const opacity = round((variant === "workspace" ? 0.2 : 0.15) + random() * 0.22, 2);
      const leftX = round(start + x * cell + (cell - size) / 2, 1);
      const rightX = round(start + (grid - 1 - x) * cell + (cell - size) / 2, 1);
      const topY = round(start + y * cell + (cell - size) / 2, 1);

      pixels.push(`<rect x="${leftX}" y="${topY}" width="${size}" height="${size}" rx="${round(size * 0.36, 1)}" fill="${color}" opacity="${opacity}"/>`);
      if (rightX !== leftX) {
        pixels.push(`<rect x="${rightX}" y="${topY}" width="${size}" height="${size}" rx="${round(size * 0.36, 1)}" fill="${color}" opacity="${opacity}"/>`);
      }
    }
  }

  return pixels.join("");
}

function buildGrain(random: () => number, variant: PaperAvatarVariant, palette: Palette): string {
  const dotCount = variant === "workspace" ? 42 : 34;
  const lineCount = variant === "workspace" ? 8 : 6;
  const pieces: string[] = [];

  for (let index = 0; index < dotCount; index += 1) {
    const color = random() > 0.34 ? palette.highlight : palette.shadow;
    const opacity = color === palette.highlight ? round(0.035 + random() * 0.08, 3) : round(0.025 + random() * 0.045, 3);
    const radius = round(0.12 + random() * 0.32, 2);

    pieces.push(`<circle cx="${round(random() * 96, 1)}" cy="${round(random() * 96, 1)}" r="${radius}" fill="${color}" opacity="${opacity}"/>`);
  }

  for (let index = 0; index < lineCount; index += 1) {
    const startX = round(random() * 96, 1);
    const startY = round(random() * 96, 1);
    const endX = round(startX + random() * 18 - 9, 1);
    const endY = round(startY + random() * 18 - 9, 1);

    pieces.push(`<path d="M${startX} ${startY}L${endX} ${endY}" stroke="${palette.highlight}" stroke-opacity=".045" stroke-width=".45" stroke-linecap="round"/>`);
  }

  return `<g opacity="${variant === "workspace" ? ".72" : ".58"}">${pieces.join("")}</g>`;
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

function hsl(hue: number, saturation: number, lightness: number): string {
  return `hsl(${normalizeHue(hue)}, ${saturation}%, ${lightness}%)`;
}

function normalizeHue(hue: number): number {
  return ((hue % 360) + 360) % 360;
}

function round(value: number, decimals: number): number {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}
