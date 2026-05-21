export function getExtensionIconSrc(iconSrc?: string, iconSlug?: string) {
  if (iconSrc) {
    if (iconSrc.startsWith("/") && !iconSrc.startsWith("//")) {
      return `${import.meta.env.BASE_URL}${iconSrc.slice(1)}`;
    }

    return iconSrc;
  }

  return iconSlug ? `https://cdn.simpleicons.org/${iconSlug}` : undefined;
}
