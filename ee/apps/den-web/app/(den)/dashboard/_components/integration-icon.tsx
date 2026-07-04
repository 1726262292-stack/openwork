"use client";

import { useState } from "react";
import { Plug } from "lucide-react";
import type { LucideIcon } from "lucide-react";

function faviconUrl(serviceUrl?: string) {
  const trimmed = serviceUrl?.trim();
  if (!trimmed?.match(/^https?:\/\//i)) return undefined;
  return `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(trimmed)}`;
}

function resolveIconUrl(input: {
  iconUrl?: string;
  simpleIconSlug?: string;
  serviceUrl?: string;
}) {
  if (input.iconUrl) return input.iconUrl;
  if (input.simpleIconSlug) return `https://cdn.simpleicons.org/${input.simpleIconSlug}`;
  return faviconUrl(input.serviceUrl);
}

export function IntegrationIcon({
  name,
  iconUrl,
  simpleIconSlug,
  serviceUrl,
  fallbackIcon: FallbackIcon = Plug,
  className = "h-10 w-10 rounded-[12px]",
  imageClassName = "h-5 w-5",
}: {
  name: string;
  iconUrl?: string;
  simpleIconSlug?: string;
  serviceUrl?: string;
  fallbackIcon?: LucideIcon;
  className?: string;
  imageClassName?: string;
}) {
  const resolvedUrl = resolveIconUrl({ iconUrl, simpleIconSlug, serviceUrl });
  const [erroredUrl, setErroredUrl] = useState<string | null>(null);
  const showImage = resolvedUrl && erroredUrl !== resolvedUrl;

  return (
    <div className={`flex shrink-0 items-center justify-center border border-gray-100 bg-white shadow-sm ${className}`}>
      {showImage ? (
        <img
          src={resolvedUrl}
          alt={`${name} icon`}
          loading="lazy"
          onError={() => setErroredUrl(resolvedUrl)}
          className={`object-contain ${imageClassName}`}
        />
      ) : (
        <FallbackIcon className="h-5 w-5 text-gray-500" aria-hidden />
      )}
    </div>
  );
}
