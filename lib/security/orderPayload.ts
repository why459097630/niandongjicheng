import crypto from "crypto";

type EncryptedPayload = {
  ciphertext: string;
  iv: string;
  tag: string;
};

const ALGORITHM = "aes-256-gcm";

function getOrderPayloadKey(): Buffer {
  const secret = (process.env.ORDER_PAYLOAD_SECRET || "").trim();

  if (!secret) {
    throw new Error("ORDER_PAYLOAD_SECRET is required.");
  }

  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptOrderPayload(value: unknown): EncryptedPayload {
  const iv = crypto.randomBytes(12);
  const key = getOrderPayloadKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const plaintext = JSON.stringify(value);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptOrderPayload<T>(input: EncryptedPayload): T {
  const key = getOrderPayloadKey();
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(input.iv, "base64"),
  );

  decipher.setAuthTag(Buffer.from(input.tag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(input.ciphertext, "base64")),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString("utf8")) as T;
}