const trackingParams = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid"
]);

export function normalizeCollectedUrl(value: string, baseUrl?: string): string | null {
  try {
    const parsed = new URL(value.trim(), baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    parsed.hash = "";
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();

    for (const param of Array.from(parsed.searchParams.keys())) {
      if (trackingParams.has(param.toLowerCase())) {
        parsed.searchParams.delete(param);
      }
    }

    const sortedParams = Array.from(parsed.searchParams.entries()).sort(([left], [right]) => left.localeCompare(right));
    parsed.search = "";
    for (const [key, value] of sortedParams) {
      parsed.searchParams.append(key, value);
    }

    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function isSameOriginUrl(url: string, baseUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}
