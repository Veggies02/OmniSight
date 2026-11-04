import React from "react";

/**
 * Deterministic SVG image fallbacks and error handlers.
 * Ensures clean rendering offline, in sandboxed/CI environments, or on network failure.
 */

function createCategorySvg(title: string, bg: string, icon: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600" fill="none">
    <rect width="600" height="600" fill="${bg}"/>
    <circle cx="300" cy="270" r="110" fill="rgba(255,255,255,0.15)"/>
    <text x="300" y="295" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="72" text-anchor="middle" fill="#ffffff">${icon}</text>
    <text x="300" y="420" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="600" text-anchor="middle" fill="#ffffff" letter-spacing="1">${title.toUpperCase()}</text>
    <text x="300" y="455" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="18" text-anchor="middle" fill="rgba(255,255,255,0.8)">OmniShop Verified Product</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const FALLBACK_IMAGES: Record<string, string> = {
  Audio: createCategorySvg("Audio", "#1e293b", "🎧"),
  Accessories: createCategorySvg("Accessories", "#334155", "⌚"),
  "Home & Kitchen": createCategorySvg("Home & Kitchen", "#0f766e", "☕"),
  Travel: createCategorySvg("Travel", "#475569", "🎒"),
  "Home & Office": createCategorySvg("Home & Office", "#3b82f6", "💡"),
  Tech: createCategorySvg("Tech", "#6366f1", "⌨️"),
  Default: createCategorySvg("OmniShop", "#0f172a", "✨"),
  Hero: `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900" fill="none">
    <rect width="1200" height="900" fill="#0f172a"/>
    <circle cx="600" cy="400" r="180" fill="rgba(59,130,246,0.15)"/>
    <text x="600" y="440" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="96" text-anchor="middle" fill="#38bdf8">🛍️</text>
    <text x="600" y="560" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="36" font-weight="700" text-anchor="middle" fill="#ffffff">OmniShop Curated Collection</text>
    <text x="600" y="610" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="20" text-anchor="middle" fill="#94a3b8">Crafted Essentials for Modern Living</text>
  </svg>`)}`,
};

export function getProductFallbackImage(category?: string): string {
  if (!category) return FALLBACK_IMAGES.Default;
  return FALLBACK_IMAGES[category] || FALLBACK_IMAGES.Default;
}

export function handleImageError(
  event: React.SyntheticEvent<HTMLImageElement, Event>,
  category?: string
): void {
  const target = event.currentTarget;
  const fallback = getProductFallbackImage(category);
  if (target.src !== fallback) {
    target.src = fallback;
  }
}
