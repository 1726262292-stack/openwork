export const PASTE_CHIP_CHAR_THRESHOLD = 50;
export const FILE_URL_RE = /^file:\/\//i;
export const HTTP_URL_RE = /^https?:\/\//i;

const WHITESPACE_RE = /\s/;

export function isStandaloneHttpUrl(text: string) {
  return HTTP_URL_RE.test(text) && !WHITESPACE_RE.test(text);
}

export function shouldCollapsePastedText(text: string) {
  return text.length > PASTE_CHIP_CHAR_THRESHOLD && !isStandaloneHttpUrl(text);
}
