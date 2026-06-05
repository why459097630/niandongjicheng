import { formatPayPalAmount } from "@/lib/paypal/pricing";

export type PayPalOrderIntent = "CAPTURE";

export type CreatePayPalOrderInput = {
  orderId: string;
  amountCents: number;
  currency: string;
  description: string;
  customId: string;
  returnUrl: string;
  cancelUrl: string;
};

export type PayPalOrderCreateResponse = {
  id: string;
  status: string;
  links?: Array<{
    href?: string;
    rel?: string;
    method?: string;
  }>;
};

export type PayPalCaptureResponse = {
  id: string;
  status: string;
  purchase_units?: Array<{
    reference_id?: string;
    custom_id?: string;
    payments?: {
      captures?: Array<{
        id?: string;
        status?: string;
        amount?: {
          currency_code?: string;
          value?: string;
        };
      }>;
    };
  }>;
};

export type PayPalWebhookEvent = {
  id?: string;
  event_type?: string;
  resource?: {
    id?: string;
    status?: string;
    amount?: {
      currency_code?: string;
      value?: string;
    };
    custom_id?: string;
    supplementary_data?: {
      related_ids?: {
        order_id?: string;
      };
    };
  };
};

function getRequiredEnv(name: string): string {
  const value = (process.env[name] || "").trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function getPayPalBaseUrl(): string {
  const mode = (process.env.PAYPAL_MODE || "sandbox").trim().toLowerCase();

  if (mode === "live") {
    return "https://api-m.paypal.com";
  }

  return "https://api-m.sandbox.paypal.com";
}

export async function getPayPalAccessToken(): Promise<string> {
  const clientId = getRequiredEnv("PAYPAL_CLIENT_ID");
  const clientSecret = getRequiredEnv("PAYPAL_CLIENT_SECRET");
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || "Failed to get PayPal access token.");
  }

  return String(data.access_token);
}

export async function createPayPalOrder(
  input: CreatePayPalOrderInput,
): Promise<PayPalOrderCreateResponse> {
  const accessToken = await getPayPalAccessToken();

  const response = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      intent: "CAPTURE" satisfies PayPalOrderIntent,
      purchase_units: [
        {
          reference_id: input.orderId,
          custom_id: input.customId,
          description: input.description,
          amount: {
            currency_code: input.currency,
            value: formatPayPalAmount(input.amountCents),
          },
        },
      ],
      application_context: {
        brand_name: "Think It Done",
        landing_page: "LOGIN",
        user_action: "PAY_NOW",
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
      },
    }),
    cache: "no-store",
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.id) {
    throw new Error(data?.message || data?.name || "Failed to create PayPal order.");
  }

  return data as PayPalOrderCreateResponse;
}

export function getPayPalApprovalUrl(order: PayPalOrderCreateResponse): string {
  const approvalLink = order.links?.find((link) => link.rel === "approve");

  if (!approvalLink?.href) {
    throw new Error("PayPal approval URL is missing.");
  }

  return approvalLink.href;
}

export async function capturePayPalOrder(
  paypalOrderId: string,
): Promise<PayPalCaptureResponse> {
  const accessToken = await getPayPalAccessToken();

  const response = await fetch(
    `${getPayPalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      cache: "no-store",
    },
  );

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.id) {
    throw new Error(data?.message || data?.name || "Failed to capture PayPal order.");
  }

  return data as PayPalCaptureResponse;
}

export function readPayPalCaptureSnapshot(input: {
  capturedOrder: PayPalCaptureResponse;
  expectedCurrency: string;
  expectedAmountCents: number;
}): {
  paypalCaptureId: string;
  amountSubtotal: number;
  amountTotal: number;
  currency: string;
  checkoutCompletedAt: string;
  paidAt: string;
} {
  const capture = input.capturedOrder.purchase_units?.[0]?.payments?.captures?.[0];

  if (!capture?.id) {
    throw new Error("PayPal capture id is missing.");
  }

  if (capture.status !== "COMPLETED") {
    throw new Error(`PayPal capture status is not completed: ${capture.status || "empty"}.`);
  }

  const currency = String(capture.amount?.currency_code || "").trim().toUpperCase();
  const amountValue = Number(capture.amount?.value || "0");
  const amountCents = Math.round(amountValue * 100);

  if (currency !== input.expectedCurrency.toUpperCase()) {
    throw new Error(`Unexpected PayPal currency. expected=${input.expectedCurrency} actual=${currency}`);
  }

  if (amountCents !== input.expectedAmountCents) {
    throw new Error(`Unexpected PayPal amount. expected=${input.expectedAmountCents} actual=${amountCents}`);
  }

  const nowIso = new Date().toISOString();

  return {
    paypalCaptureId: capture.id,
    amountSubtotal: amountCents,
    amountTotal: amountCents,
    currency: currency.toLowerCase(),
    checkoutCompletedAt: nowIso,
    paidAt: nowIso,
  };
}

export async function verifyPayPalWebhook(input: {
  headers: Headers;
  event: PayPalWebhookEvent;
}): Promise<boolean> {
  const webhookId = getRequiredEnv("PAYPAL_WEBHOOK_ID");
  const accessToken = await getPayPalAccessToken();

  const response = await fetch(`${getPayPalBaseUrl()}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      auth_algo: input.headers.get("paypal-auth-algo") || "",
      cert_url: input.headers.get("paypal-cert-url") || "",
      transmission_id: input.headers.get("paypal-transmission-id") || "",
      transmission_sig: input.headers.get("paypal-transmission-sig") || "",
      transmission_time: input.headers.get("paypal-transmission-time") || "",
      webhook_id: webhookId,
      webhook_event: input.event,
    }),
    cache: "no-store",
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.message || data?.name || "Failed to verify PayPal webhook.");
  }

  return data?.verification_status === "SUCCESS";
}