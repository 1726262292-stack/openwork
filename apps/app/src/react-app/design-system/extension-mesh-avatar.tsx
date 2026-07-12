/** @jsxImportSource react */
import { Puzzle } from "lucide-react";
import { cn } from "@/lib/utils";

type ExtensionMeshAvatarProps = {
  name: string;
  category?: string;
  className?: string;
  square?: boolean;
};

export function ExtensionMeshAvatar({ name, category = "fallback", className, square = true }: ExtensionMeshAvatarProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center border border-dls-border bg-dls-surface text-dls-secondary",
        square ? "rounded-md" : "rounded-full",
        className,
      )}
      data-openwork-extension-avatar="true"
      data-extension-kind={category}
      data-extension-name={name}
      data-extension-identity="neutral"
      role="presentation"
      aria-hidden="true"
    >
      <Puzzle className="size-[55%]" strokeWidth={1.8} />
    </div>
  );
}
