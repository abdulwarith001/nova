import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";
import machineIdModule from "node-machine-id";

const ALGORITHM = "aes-256-gcm";
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Derive encryption key from machine-specific data
 * @returns 32-byte encryption key
 */
function deriveKey(): Buffer {
  const { machineIdSync } = machineIdModule as {
    machineIdSync: () => string;
  };
  const machineId = machineIdSync();
  const salt = scryptSync(machineId, "nova-encryption-salt", SALT_LENGTH);
  return scryptSync("nova-secret-key", salt, 32);
}

/**
 * Encrypt sensitive data (OAuth tokens, API keys, etc.)
 * Uses AES-256-GCM with machine-specific key
 *
 * @param text Plain text to encrypt
 * @returns Hex-encoded string: IV + AuthTag + Ciphertext
 */
export function encrypt(text: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const tag = cipher.getAuthTag();

  // Return: iv (32 hex chars) + tag (32 hex chars) + encrypted
  return iv.toString("hex") + tag.toString("hex") + encrypted;
}

/**
 * Decrypt encrypted data
 *
 * @param encryptedData Hex-encoded string from encrypt()
 * @returns Original plain text
 * @throws Error if decryption fails (tampered data, wrong machine, etc.)
 */
export function decrypt(encryptedData: string): string {
  const key = deriveKey();

  // Parse components
  const iv = Buffer.from(encryptedData.slice(0, IV_LENGTH * 2), "hex");
  const tag = Buffer.from(
    encryptedData.slice(IV_LENGTH * 2, (IV_LENGTH + TAG_LENGTH) * 2),
    "hex",
  );
  const encrypted = encryptedData.slice((IV_LENGTH + TAG_LENGTH) * 2);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Check if a string appears to be encrypted
 */
export function isEncrypted(value: string): boolean {
  // Encrypted values are hex strings with specific length
  const minLength = (IV_LENGTH + TAG_LENGTH) * 2;
  return (
    value.length > minLength && /^[0-9a-f]+$/i.test(value.slice(0, minLength))
  );
}
