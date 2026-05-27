/** @jsxImportSource react */
import type { GrainArtCategory } from "./grain-art";
import { grainArtSrc } from "./grain-art";

type ExtensionMeshAvatarProps = {
  name: string;
  category?: GrainArtCategory;
  className?: string;
};

export function extensionMeshAvatarText(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length >= 2
    ? `${words[0][0]}${words[1][0]}`
    : (words[0] ?? "E").slice(0, 2);
  return letters.toUpperCase();
}

export function ExtensionMeshAvatar({ name, category = "fallback", className }: ExtensionMeshAvatarProps) {
  return (
    <div className={`relative isolate overflow-hidden ${className ?? ""}`}>
      <img
        src={grainArtSrc(category, name)}
        alt=""
        loading="lazy"
        decoding="async"
        className="absolute inset-0 size-full object-cover"
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/10 text-white drop-shadow-sm">
        {extensionMeshAvatarText(name)}
      </div>
    </div>
  );
}
