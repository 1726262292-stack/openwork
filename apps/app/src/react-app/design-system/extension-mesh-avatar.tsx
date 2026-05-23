/** @jsxImportSource react */
import { getPaperAvatarStyle } from "./paper-avatar-svg";

type ExtensionMeshAvatarProps = {
  name: string;
  className?: string;
};

export function extensionMeshAvatarText(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length >= 2
    ? `${words[0][0]}${words[1][0]}`
    : (words[0] ?? "E").slice(0, 2);
  return letters.toUpperCase();
}

export function ExtensionMeshAvatar({ name, className }: ExtensionMeshAvatarProps) {
  return (
    <div
      className={`relative isolate overflow-hidden ${className ?? ""}`}
      style={getPaperAvatarStyle(name, "extension")}
    >
      <div className="absolute inset-0 flex items-center justify-center bg-black/5 text-white drop-shadow-sm">
        {extensionMeshAvatarText(name)}
      </div>
    </div>
  );
}
