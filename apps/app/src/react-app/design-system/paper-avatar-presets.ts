export type PaperAvatarVariant = "extension" | "workspace";

type PaperAvatarStyle = {
  backgroundColor: string;
  backgroundImage: string;
  backgroundPosition: string;
  backgroundSize: string;
};

const avatarPresetCount = 512;
const styleCache = new Map<string, PaperAvatarStyle>();

export function getPaperAvatarStyle(seed: string, variant: PaperAvatarVariant): PaperAvatarStyle {
  const normalizedSeed = seed.trim() || variant;
  const cacheKey = `${variant}:${normalizedSeed}`;
  const cached = styleCache.get(cacheKey);
  if (cached) return cached;

  const presetIndex = hashSeed(normalizedSeed, `avatar-preset:${variant}`) % avatarPresetCount;
  const hue = hashSeed(normalizedSeed, `avatar-fallback:${variant}`) % 360;
  const style = {
    backgroundColor: `hsl(${hue}, 90%, 14%)`,
    backgroundImage: `${avatarPresetUrl(presetIndex)}, ${fallbackGradient(hue)}`,
    backgroundPosition: "center",
    backgroundSize: "cover",
  };

  styleCache.set(cacheKey, style);
  return style;
}

function avatarPresetUrl(index: number): string {
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return `url("${base}avatar-presets/paper-avatar-${String(index).padStart(3, "0")}.webp")`;
}

function fallbackGradient(hue: number): string {
  return [
    `radial-gradient(circle at 28% 24%, hsl(${hue}, 98%, 62%), transparent 42%)`,
    `radial-gradient(circle at 76% 34%, hsl(${normalizeHue(hue + 78)}, 96%, 58%), transparent 44%)`,
    `radial-gradient(circle at 46% 82%, hsl(${normalizeHue(hue + 154)}, 92%, 56%), transparent 48%)`,
    `linear-gradient(135deg, hsl(${normalizeHue(hue + 232)}, 82%, 12%), hsl(${normalizeHue(hue + 292)}, 84%, 18%))`,
  ].join(", ");
}

function hashSeed(seed: string, salt: string): number {
  const value = `${salt}:${seed}`;
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }

  return hash >>> 0;
}

function normalizeHue(hue: number): number {
  return ((hue % 360) + 360) % 360;
}
