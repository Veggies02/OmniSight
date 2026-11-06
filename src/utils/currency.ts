/**
 * Currency utilities for precise monetary calculations using integer cents.
 * Prevents IEEE 754 floating-point rounding errors across cart, checkout, and product displays.
 */

export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function computeLineTotal(priceInDollars: number, quantity: number): number {
  const lineTotalCents = toCents(priceInDollars) * Math.max(0, Math.floor(quantity));
  return fromCents(lineTotalCents);
}

export function computeSubtotal(items: Array<{ product: { price: number }; quantity: number }>): number {
  const subtotalCents = items.reduce((sum, item) => {
    return sum + toCents(item.product.price) * Math.max(0, Math.floor(item.quantity));
  }, 0);
  return fromCents(subtotalCents);
}

export function formatPrice(priceInDollars: number): string {
  return (toCents(priceInDollars) / 100).toFixed(2);
}
