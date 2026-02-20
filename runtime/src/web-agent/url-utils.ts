export interface CanonicalizeOptions {
  stripHash?: boolean;
  stripTrackingParams?: boolean;
}

const TRACKING_PARAM_PREFIXES = ["utm_", "fbclid", "gclid", "msclkid"];
const BLOCKED_HOST_PATTERNS = [
  /(^|\.)duckduckgo\.com$/i,
  /(^|\.)bing\.com$/i,
  /(^|\.)example\.com$/i,
];

export function canonicalizeUrl(
  rawUrl: string,
  options?: CanonicalizeOptions,
): string {
  const stripHash = options?.stripHash !== false;
  const stripTrackingParams = options?.stripTrackingParams !== false;

  try {
    const parsed = new URL(String(rawUrl || "").trim());
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();

    if (
      (parsed.protocol === "https:" && parsed.port === "443") ||
      (parsed.protocol === "http:" && parsed.port === "80")
    ) {
      parsed.port = "";
    }

    if (stripHash) parsed.hash = "";

    if (stripTrackingParams) {
      for (const key of Array.from(parsed.searchParams.keys())) {
        const lowered = key.toLowerCase();
        if (
          TRACKING_PARAM_PREFIXES.some((prefix) =>
            lowered.startsWith(prefix.toLowerCase()),
          )
        ) {
          parsed.searchParams.delete(key);
        }
      }
    }

    const normalized = parsed.toString();
    return normalized.endsWith("/")
      ? normalized.slice(0, normalized.length - 1)
      : normalized;
  } catch {
    return String(rawUrl || "").trim();
  }
}

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(String(url || "").trim());
}

export function dedupeCanonicalUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of urls) {
    const canonical = canonicalizeUrl(value);
    if (!isHttpUrl(canonical)) continue;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }

  return out;
}

export function extractExplicitUrls(text: string): string[] {
  const matches = String(text || "").match(/https?:\/\/[^\s)]+/gi) || [];
  return dedupeCanonicalUrls(matches);
}

export function isBlockedSourceUrl(rawUrl: string): boolean {
  const normalized = canonicalizeUrl(rawUrl);
  if (!isHttpUrl(normalized)) return true;

  try {
    const parsed = new URL(normalized);
    if (BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname))) {
      return true;
    }
    if (/\/search/i.test(parsed.pathname) && /(^|\.)bing\.com$/i.test(parsed.hostname)) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}
