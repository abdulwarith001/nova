/**
 * Encrypt sensitive data (OAuth tokens, API keys, etc.)
 * Uses AES-256-GCM with machine-specific key
 *
 * @param text Plain text to encrypt
 * @returns Hex-encoded string: IV + AuthTag + Ciphertext
 */
export declare function encrypt(text: string): string;
/**
 * Decrypt encrypted data
 *
 * @param encryptedData Hex-encoded string from encrypt()
 * @returns Original plain text
 * @throws Error if decryption fails (tampered data, wrong machine, etc.)
 */
export declare function decrypt(encryptedData: string): string;
/**
 * Check if a string appears to be encrypted
 */
export declare function isEncrypted(value: string): boolean;
