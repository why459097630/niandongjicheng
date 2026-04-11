import crypto from "node:crypto";

const GUEST_CHAT_SECRET =
  process.env.GUEST_CHAT_SECRET?.trim() ||
  process.env.ADMIN_EMAIL_ALLOWLIST?.trim() ||
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
  "ndjc_guest_chat_secret";

function signPayload(payload: string) {
  return crypto.createHmac("sha256", GUEST_CHAT_SECRET).update(payload).digest("base64url");
}

export function createGuestAccessToken(conversationId: string, guestSessionId: string) {
  const payload = `${conversationId}.${guestSessionId}`;
  const signature = signPayload(payload);
  return `${payload}.${signature}`;
}

export function verifyGuestAccessToken(
  token: string,
  conversationId: string,
  guestSessionId: string
) {
  const nextToken = token.trim();

  if (!nextToken) {
    return false;
  }

  const parts = nextToken.split(".");

  if (parts.length < 3) {
    return false;
  }

  const signature = parts.pop() || "";
  const tokenGuestSessionId = parts.pop() || "";
  const tokenConversationId = parts.join(".");

  if (!tokenConversationId || !tokenGuestSessionId || !signature) {
    return false;
  }

  if (tokenConversationId !== conversationId) {
    return false;
  }

  if (tokenGuestSessionId !== guestSessionId) {
    return false;
  }

  const payload = `${tokenConversationId}.${tokenGuestSessionId}`;
  const expectedSignature = signPayload(payload);

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

export function parseGuestAccessToken(token: string) {
  const nextToken = token.trim();

  if (!nextToken) {
    return null;
  }

  const parts = nextToken.split(".");

  if (parts.length < 3) {
    return null;
  }

  const signature = parts.pop() || "";
  const guestSessionId = parts.pop() || "";
  const conversationId = parts.join(".");

  if (!conversationId || !guestSessionId || !signature) {
    return null;
  }

  return {
    conversationId,
    guestSessionId,
    signature,
  };
}