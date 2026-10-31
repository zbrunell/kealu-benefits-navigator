//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Generate a random row id in the browser.
 *
 * `crypto.randomUUID()` exists only in secure contexts (HTTPS or localhost), so
 * opening the app over plain HTTP on a LAN address — or in an older browser —
 * throws "crypto.randomUUID is not a function". `crypto.getRandomValues()` is
 * available in every context, so it backs the fallback.
 */
export function createClientId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // RFC 4122 version 4 / variant bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
