import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptRoot, "..");
const outputDir = resolve(appRoot, "public", "avatar-presets");
const manifestPath = resolve(outputDir, "manifest.json");
const presetCount = 512;
const size = 96;
const version = 1;
const concurrency = 16;

if (await presetsAreCurrent()) {
  console.log(`avatar-presets: ${presetCount} WebP presets already current`);
  process.exit(0);
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

let nextIndex = 0;
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (nextIndex < presetCount) {
      const index = nextIndex;
      nextIndex += 1;
      await renderPreset(index);
    }
  }),
);

await writeFile(
  manifestPath,
  `${JSON.stringify({ version, presetCount, size, format: "webp" }, null, 2)}\n`,
);

console.log(`avatar-presets: generated ${presetCount} ${size}x${size} WebP presets`);

async function presetsAreCurrent() {
  if (!existsSync(manifestPath)) return false;

  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.version !== version || manifest.presetCount !== presetCount || manifest.size !== size || manifest.format !== "webp") {
      return false;
    }

    for (let index = 0; index < presetCount; index += 1) {
      if (!existsSync(presetPath(index))) return false;
    }

    return true;
  } catch {
    return false;
  }
}

async function renderPreset(index) {
  await sharp(Buffer.from(generateSvg(index)))
    .webp({ quality: 78, effort: 4, smartSubsample: true })
    .toFile(presetPath(index));
}

function presetPath(index) {
  return resolve(outputDir, `paper-avatar-${String(index).padStart(3, "0")}.webp`);
}

function generateSvg(index) {
  const random = createRandom(index);
  const palette = createPalette(index, random);
  const glowDefs = [];
  const glowLayers = [];
  const ribbonDefs = [];
  const ribbonLayers = [];

  for (let layer = 0; layer < 8; layer += 1) {
    const color = palette.glows[layer % palette.glows.length];
    const cx = round(-10 + random() * 116, 1);
    const cy = round(-10 + random() * 116, 1);
    const rx = round(24 + random() * 42, 1);
    const ry = round(18 + random() * 36, 1);
    const rotation = Math.round(random() * 180);
    const opacity = round(0.42 + random() * 0.36, 2);

    glowDefs.push(
      `<radialGradient id="g${layer}" cx="50%" cy="50%" r="50%">` +
        `<stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/>` +
        `<stop offset=".42" stop-color="${color}" stop-opacity="${round(opacity * 0.38, 2)}"/>` +
        `<stop offset="1" stop-color="${color}" stop-opacity="0"/>` +
      `</radialGradient>`,
    );
    glowLayers.push(
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#g${layer})" transform="rotate(${rotation} ${cx} ${cy})"/>`,
    );
  }

  for (let layer = 0; layer < 3; layer += 1) {
    const first = palette.glows[(layer + 1) % palette.glows.length];
    const second = palette.glows[(layer + 3) % palette.glows.length];
    const startY = round(12 + random() * 72, 1);
    const endY = round(12 + random() * 72, 1);
    const controlA = round(0 + random() * 96, 1);
    const controlB = round(0 + random() * 96, 1);
    const width = round(8 + random() * 14, 1);
    const path = `M -18 ${startY} C 18 ${controlA} 60 ${controlB} 114 ${endY}`;

    ribbonDefs.push(
      `<linearGradient id="r${layer}" x1="0" y1="0" x2="96" y2="96" gradientUnits="userSpaceOnUse">` +
        `<stop offset="0" stop-color="${first}"/>` +
        `<stop offset=".5" stop-color="#fff"/>` +
        `<stop offset="1" stop-color="${second}"/>` +
      `</linearGradient>`,
    );
    ribbonLayers.push(
      `<path d="${path}" fill="none" stroke="url(#r${layer})" stroke-opacity="${round(0.16 + random() * 0.14, 2)}" stroke-width="${width}" stroke-linecap="round" filter="url(#soften)"/>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 96 96">` +
      `<defs>` +
        `<linearGradient id="base" x1="0" y1="0" x2="1" y2="1">` +
          `<stop offset="0" stop-color="${palette.baseA}"/>` +
          `<stop offset=".58" stop-color="${palette.baseB}"/>` +
          `<stop offset="1" stop-color="${palette.baseC}"/>` +
        `</linearGradient>` +
        `<radialGradient id="lift" cx="50%" cy="42%" r="76%">` +
          `<stop offset="0" stop-color="#fff" stop-opacity=".16"/>` +
          `<stop offset=".48" stop-color="#fff" stop-opacity="0"/>` +
          `<stop offset="1" stop-color="#020617" stop-opacity=".42"/>` +
        `</radialGradient>` +
        `<filter id="soften" x="-20%" y="-20%" width="140%" height="140%">` +
          `<feGaussianBlur stdDeviation="1.6"/>` +
        `</filter>` +
        glowDefs.join("") +
        ribbonDefs.join("") +
      `</defs>` +
      `<rect width="96" height="96" fill="url(#base)"/>` +
      glowLayers.join("") +
      ribbonLayers.join("") +
      buildMotif(index, random, palette) +
      `<rect width="96" height="96" fill="url(#lift)"/>` +
      buildGrain(random) +
    `</svg>`
  );
}

function createPalette(index, random) {
  const hue = (index * 137 + Math.floor(random() * 46)) % 360;

  return {
    baseA: hsl(hue + 232, 82, 10),
    baseB: hsl(hue + 278, 86, 15),
    baseC: hsl(hue + 214, 78, 6),
    glows: [
      hsl(hue, 98, 62),
      hsl(hue + 72, 98, 58),
      hsl(hue + 148, 94, 56),
      hsl(hue + 222, 96, 62),
      hsl(hue + 296, 98, 66),
    ],
  };
}

function buildMotif(index, random, palette) {
  switch (index % 4) {
    case 0:
      return buildOrbitMotif(random, palette);
    case 1:
      return buildPrismMotif(random, palette);
    case 2:
      return buildPixelMotif(random, palette);
    default:
      return buildArcMotif(random, palette);
  }
}

function buildOrbitMotif(random, palette) {
  const rotation = Math.round(random() * 90) - 45;
  const secondRotation = rotation + 64 + Math.round(random() * 28);

  return (
    `<ellipse cx="48" cy="48" rx="${round(22 + random() * 10, 1)}" ry="${round(8 + random() * 8, 1)}" fill="none" stroke="#fff" stroke-opacity=".32" stroke-width="1.3" transform="rotate(${rotation} 48 48)"/>` +
    `<ellipse cx="48" cy="48" rx="${round(28 + random() * 11, 1)}" ry="${round(12 + random() * 10, 1)}" fill="none" stroke="${palette.glows[1]}" stroke-opacity=".22" stroke-width="1" transform="rotate(${secondRotation} 48 48)"/>` +
    `<circle cx="${round(28 + random() * 40, 1)}" cy="${round(26 + random() * 44, 1)}" r="${round(2.4 + random() * 3.2, 1)}" fill="#fff" opacity=".34"/>`
  );
}

function buildPrismMotif(random, palette) {
  const shift = round(random() * 18 - 9, 1);

  return (
    `<path d="M${round(9 + shift, 1)} 86 L${round(41 + shift, 1)} 17 L${round(77 + shift, 1)} 86 Z" fill="#fff" opacity=".13"/>` +
    `<path d="M${round(41 + shift, 1)} 17 L${round(77 + shift, 1)} 86 L${round(53 + shift, 1)} 68 Z" fill="${palette.glows[0]}" opacity=".28"/>` +
    `<path d="M${round(9 + shift, 1)} 86 L${round(41 + shift, 1)} 17 L${round(53 + shift, 1)} 68 Z" fill="${palette.glows[2]}" opacity=".24"/>`
  );
}

function buildPixelMotif(random, palette) {
  const grid = 5;
  const cell = 8;
  const start = 48 - (grid * cell) / 2;
  const colors = ["#fff", ...palette.glows];
  const pixels = [];

  for (let y = 0; y < grid; y += 1) {
    for (let x = 0; x < Math.ceil(grid / 2); x += 1) {
      if (random() < 0.48) continue;

      const color = colors[(x + y + Math.floor(random() * colors.length)) % colors.length];
      const dotSize = round(2.4 + random() * 3, 1);
      const opacity = round(0.18 + random() * 0.28, 2);
      const leftX = round(start + x * cell + (cell - dotSize) / 2, 1);
      const rightX = round(start + (grid - 1 - x) * cell + (cell - dotSize) / 2, 1);
      const topY = round(start + y * cell + (cell - dotSize) / 2, 1);
      const rx = round(dotSize * 0.36, 1);

      pixels.push(`<rect x="${leftX}" y="${topY}" width="${dotSize}" height="${dotSize}" rx="${rx}" fill="${color}" opacity="${opacity}"/>`);
      if (rightX !== leftX) {
        pixels.push(`<rect x="${rightX}" y="${topY}" width="${dotSize}" height="${dotSize}" rx="${rx}" fill="${color}" opacity="${opacity}"/>`);
      }
    }
  }

  return pixels.join("");
}

function buildArcMotif(random, palette) {
  const start = round(18 + random() * 20, 1);
  const end = round(58 + random() * 20, 1);

  return (
    `<path d="M${start} 78 C${round(18 + random() * 20, 1)} ${round(26 + random() * 22, 1)} ${round(56 + random() * 18, 1)} ${round(20 + random() * 24, 1)} ${end} 18" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="2.2" stroke-linecap="round"/>` +
    `<path d="M${round(start - 9, 1)} 76 C${round(24 + random() * 18, 1)} ${round(38 + random() * 18, 1)} ${round(54 + random() * 22, 1)} ${round(42 + random() * 14, 1)} ${round(end + 8, 1)} 26" fill="none" stroke="${palette.glows[3]}" stroke-opacity=".22" stroke-width="5.5" stroke-linecap="round" filter="url(#soften)"/>`
  );
}

function buildGrain(random) {
  const pieces = [];

  for (let index = 0; index < 48; index += 1) {
    const fill = random() > 0.32 ? "#fff" : "#020617";
    const opacity = fill === "#fff" ? round(0.035 + random() * 0.08, 3) : round(0.025 + random() * 0.04, 3);
    pieces.push(`<circle cx="${round(random() * 96, 1)}" cy="${round(random() * 96, 1)}" r="${round(0.12 + random() * 0.3, 2)}" fill="${fill}" opacity="${opacity}"/>`);
  }

  for (let index = 0; index < 7; index += 1) {
    const startX = round(random() * 96, 1);
    const startY = round(random() * 96, 1);
    pieces.push(`<path d="M${startX} ${startY}L${round(startX + random() * 18 - 9, 1)} ${round(startY + random() * 18 - 9, 1)}" stroke="#fff" stroke-opacity=".045" stroke-width=".45" stroke-linecap="round"/>`);
  }

  return `<g opacity=".68">${pieces.join("")}</g>`;
}

function createRandom(index) {
  let state = (index * 747796405 + 2891336453) >>> 0;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function hsl(hue, saturation, lightness) {
  return `hsl(${normalizeHue(hue)}, ${saturation}%, ${lightness}%)`;
}

function normalizeHue(hue) {
  return ((hue % 360) + 360) % 360;
}

function round(value, decimals) {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}
