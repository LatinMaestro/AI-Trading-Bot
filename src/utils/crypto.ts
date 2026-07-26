import { base64ToBytes, bytesToBase64, bytesToHex } from "./encoding.ts";

const encoder = new TextEncoder();

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function krakenSignature(
  urlPath: string,
  nonce: string,
  formBody: string,
  secretBase64: string,
): Promise<string> {
  const bodyHash = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${nonce}${formBody}`),
  );
  const message = new Uint8Array(
    encoder.encode(urlPath).length + bodyHash.byteLength,
  );
  message.set(encoder.encode(urlPath), 0);
  message.set(new Uint8Array(bodyHash), encoder.encode(urlPath).length);

  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(secretBase64),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, message);
  return bytesToBase64(new Uint8Array(signature));
}
