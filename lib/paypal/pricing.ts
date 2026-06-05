export type PayPalRenewId = "30d" | "90d" | "180d";

export const PAYPAL_PRICE_MARKERS = {
  generate: "paypal:generate_app:setup",
  renew30d: "paypal:renew_cloud:30d",
  renew90d: "paypal:renew_cloud:90d",
  renew180d: "paypal:renew_cloud:180d",
} as const;

function readAmountFromEnv(name: string, fallback: string): number {
  const raw = (process.env[name] || fallback).trim();
  const value = Number(raw);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }

  return Math.round(value * 100);
}

export function getPayPalCurrency(): string {
  const currency = (process.env.PAYPAL_CURRENCY || "USD").trim().toUpperCase();

  if (!currency) {
    throw new Error("PAYPAL_CURRENCY is required.");
  }

  return currency;
}

export function getPayPalGenerateAmountCents(): number {
  return readAmountFromEnv("PAYPAL_SETUP_AMOUNT", "99.00");
}

export function getPayPalRenewAmountCents(renewId: string): number {
  if (renewId === "30d") {
    return readAmountFromEnv(
      "PAYPAL_RENEW_30D_AMOUNT",
      process.env.PAYPAL_CLOUD_MONTHLY_AMOUNT || "39.00",
    );
  }

  if (renewId === "90d") {
    return readAmountFromEnv("PAYPAL_RENEW_90D_AMOUNT", "117.00");
  }

  if (renewId === "180d") {
    return readAmountFromEnv("PAYPAL_RENEW_180D_AMOUNT", "234.00");
  }

  throw new Error("Invalid renewId.");
}

export function getPayPalPriceMarker(input: {
  kind: "generate_app" | "renew_cloud";
  renewId?: string | null;
}): string {
  if (input.kind === "generate_app") {
    return PAYPAL_PRICE_MARKERS.generate;
  }

  if (input.renewId === "30d") {
    return PAYPAL_PRICE_MARKERS.renew30d;
  }

  if (input.renewId === "90d") {
    return PAYPAL_PRICE_MARKERS.renew90d;
  }

  if (input.renewId === "180d") {
    return PAYPAL_PRICE_MARKERS.renew180d;
  }

  throw new Error("Invalid PayPal renewal price marker.");
}

export function formatPayPalAmount(amountCents: number): string {
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("PayPal amount must be a positive number.");
  }

  return (Math.round(amountCents) / 100).toFixed(2);
}