//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Unit tests for ZIP-code location resolution.
 *
 * Contract: city, state, and county are derived from the ZIP so the applicant is
 * never asked for them — and anything that cannot be resolved comes back blank
 * rather than guessed.
 *
 * The CMS Marketplace client is mocked at the module boundary; no network calls
 * are made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetCountiesByZip = vi.fn();

vi.mock('@/lib/cms-marketplace', () => ({
  getCountiesByZip: (zip: string) => mockGetCountiesByZip(zip),
}));

import {
  __clearLocationCache,
  EMPTY_LOCATION,
  normalizeCountyName,
  normalizeZip,
  resolveZipLocation,
  resolveZipLocationOffline,
  stateFromZipPrefix,
} from '@/lib/location';

beforeEach(() => {
  mockGetCountiesByZip.mockReset();
  __clearLocationCache();
});

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

describe('normalizeZip', () => {
  it('accepts a five-digit ZIP', () => {
    expect(normalizeZip('90001')).toBe('90001');
  });

  it('accepts ZIP+4 and keeps only the five-digit prefix', () => {
    expect(normalizeZip('90001-1234')).toBe('90001');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeZip('  94102 ')).toBe('94102');
  });

  it('rejects anything that is not five digits', () => {
    for (const value of ['abcde', '1234', '', '   ', undefined, null]) {
      expect(normalizeZip(value)).toBe('');
    }
  });
});

describe('normalizeCountyName', () => {
  it('strips the trailing " County" that CMS returns', () => {
    expect(normalizeCountyName('Los Angeles County')).toBe('Los Angeles');
    expect(normalizeCountyName('San Francisco County')).toBe('San Francisco');
  });

  it('leaves a bare county name unchanged', () => {
    expect(normalizeCountyName('Yolo')).toBe('Yolo');
  });
});

describe('stateFromZipPrefix', () => {
  it('resolves California, Texas, and New York prefixes', () => {
    expect(stateFromZipPrefix('90001')).toBe('CA');
    expect(stateFromZipPrefix('96162')).toBe('CA');
    expect(stateFromZipPrefix('77001')).toBe('TX');
    expect(stateFromZipPrefix('10001')).toBe('NY');
  });

  it('returns empty for an unassigned prefix', () => {
    expect(stateFromZipPrefix('00000')).toBe('');
    expect(stateFromZipPrefix('nope')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Offline resolution
// ---------------------------------------------------------------------------

describe('resolveZipLocationOffline', () => {
  it('resolves city, county, and state from the exact-ZIP table', () => {
    expect(resolveZipLocationOffline('90001')).toEqual({
      city: 'Los Angeles',
      county: 'Los Angeles',
      state: 'CA',
      source: 'table',
    });

    expect(resolveZipLocationOffline('94102')).toEqual({
      city: 'San Francisco',
      county: 'San Francisco',
      state: 'CA',
      source: 'table',
    });
  });

  it('distinguishes two counties that share a ZIP prefix', () => {
    // Both are 917xx, but they sit in different counties — proof that county is
    // never inferred from the prefix.
    expect(resolveZipLocationOffline('91744').county).toBe('Los Angeles');
    expect(resolveZipLocationOffline('91764').county).toBe('San Bernardino');
  });

  it('resolves state only for a ZIP outside the exact table', () => {
    const result = resolveZipLocationOffline('93999');

    expect(result.state).toBe('CA');
    expect(result.city).toBe('');
    expect(result.county).toBe('');
    expect(result.source).toBe('prefix');
  });

  it('returns an empty location for an unresolvable ZIP', () => {
    expect(resolveZipLocationOffline('abcde')).toEqual({
      ...EMPTY_LOCATION,
      source: 'unresolved',
    });
  });
});

// ---------------------------------------------------------------------------
// Full resolution (table → CMS → prefix)
// ---------------------------------------------------------------------------

describe('resolveZipLocation', () => {
  it('uses the exact table without calling CMS', async () => {
    const result = await resolveZipLocation('90001');

    expect(result).toMatchObject({
      city: 'Los Angeles',
      state: 'CA',
      county: 'Los Angeles',
      source: 'table',
    });
    expect(mockGetCountiesByZip).not.toHaveBeenCalled();
  });

  it('falls back to CMS for county and state when the ZIP is not in the table', async () => {
    mockGetCountiesByZip.mockResolvedValue([
      { fips: '06107', name: 'Tulare County', state: 'CA' },
    ]);

    const result = await resolveZipLocation('93247');

    expect(mockGetCountiesByZip).toHaveBeenCalledWith('93247');
    expect(result.county).toBe('Tulare');
    expect(result.state).toBe('CA');
    // CMS does not return a city, so it stays blank rather than being guessed.
    expect(result.city).toBe('');
    expect(result.source).toBe('cms');
  });

  it('memoizes CMS lookups per ZIP', async () => {
    mockGetCountiesByZip.mockResolvedValue([
      { fips: '06107', name: 'Tulare County', state: 'CA' },
    ]);

    await resolveZipLocation('93247');
    await resolveZipLocation('93247');

    expect(mockGetCountiesByZip).toHaveBeenCalledTimes(1);
  });

  it('leaves county blank when a ZIP spans multiple counties', async () => {
    mockGetCountiesByZip.mockResolvedValue([
      { fips: '06037', name: 'Los Angeles County', state: 'CA' },
      { fips: '06059', name: 'Orange County', state: 'CA' },
    ]);

    const result = await resolveZipLocation('90632');

    expect(result.state).toBe('CA');
    expect(result.county).toBe('');
  });

  it('prefers the county whose state matches the ZIP prefix', async () => {
    mockGetCountiesByZip.mockResolvedValue([
      { fips: '32031', name: 'Washoe County', state: 'NV' },
      { fips: '06057', name: 'Nevada County', state: 'CA' },
    ]);

    const result = await resolveZipLocation('96161');

    expect(result.state).toBe('CA');
    expect(result.county).toBe('Nevada');
  });

  it('degrades to the prefix state when CMS is unavailable', async () => {
    mockGetCountiesByZip.mockRejectedValue(new Error('CMS_API_KEY is not configured.'));

    const result = await resolveZipLocation('93247');

    expect(result.state).toBe('CA');
    expect(result.county).toBe('');
    expect(result.city).toBe('');
    expect(result.source).toBe('prefix');
  });

  it('never throws and never invents a location for a bad ZIP', async () => {
    await expect(resolveZipLocation('not-a-zip')).resolves.toEqual({
      ...EMPTY_LOCATION,
      source: 'unresolved',
    });
    expect(mockGetCountiesByZip).not.toHaveBeenCalled();
  });

  it('resolves a non-California ZIP to its state without a county guess', async () => {
    mockGetCountiesByZip.mockRejectedValue(new Error('offline'));

    const result = await resolveZipLocation('77001');

    expect(result.state).toBe('TX');
    expect(result.county).toBe('');
    expect(result.city).toBe('');
  });
});
