import { describe, it, expect } from 'vitest';
import {
  computeDecayFactor,
  parseDecayHalfLife,
  EVERGREEN_TAGS,
} from '../src/memory-store.js';

// ── Unit tests for temporal decay functions ───────────────────────
//
// These test the pure decay functions directly, independently of
// LanceDB. Integration-level decay tests are in integration.test.ts.

describe('parseDecayHalfLife', () => {
  it('returns 30 when undefined', () => {
    expect(parseDecayHalfLife(undefined)).toBe(30);
  });

  it('parses a valid number string', () => {
    expect(parseDecayHalfLife('60')).toBe(60);
    expect(parseDecayHalfLife('7')).toBe(7);
    expect(parseDecayHalfLife('365')).toBe(365);
  });

  it('returns 0 for zero', () => {
    expect(parseDecayHalfLife('0')).toBe(0);
  });

  it('returns 0 for negative values', () => {
    expect(parseDecayHalfLife('-10')).toBe(0);
    expect(parseDecayHalfLife('-1')).toBe(0);
  });

  it('returns 0 for non-numeric strings', () => {
    expect(parseDecayHalfLife('abc')).toBe(0);
    expect(parseDecayHalfLife('')).toBe(0);
  });

  it('handles fractional values', () => {
    expect(parseDecayHalfLife('0.5')).toBe(0.5);
    expect(parseDecayHalfLife('14.5')).toBe(14.5);
  });
});

describe('computeDecayFactor', () => {
  it('returns 1.0 for a memory updated just now', () => {
    const now = new Date().toISOString();
    const factor = computeDecayFactor(now, 30);
    expect(factor).toBeCloseTo(1.0, 2);
  });

  it('returns ~0.5 for a memory aged exactly one half-life', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const factor = computeDecayFactor(thirtyDaysAgo, 30);
    expect(factor).toBeCloseTo(0.5, 2);
  });

  it('returns ~0.25 for a memory aged two half-lives', () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const factor = computeDecayFactor(sixtyDaysAgo, 30);
    expect(factor).toBeCloseTo(0.25, 2);
  });

  it('returns ~0.125 for a memory aged three half-lives', () => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const factor = computeDecayFactor(ninetyDaysAgo, 30);
    expect(factor).toBeCloseTo(0.125, 2);
  });

  it('returns 1.0 when half-life is 0 (decay disabled)', () => {
    const oldDate = new Date(Date.now() - 365 * 86_400_000).toISOString();
    expect(computeDecayFactor(oldDate, 0)).toBe(1);
  });

  it('returns 1.0 when half-life is negative (decay disabled)', () => {
    const oldDate = new Date(Date.now() - 365 * 86_400_000).toISOString();
    expect(computeDecayFactor(oldDate, -5)).toBe(1);
  });

  it('handles a short half-life (7 days)', () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const factor = computeDecayFactor(sevenDaysAgo, 7);
    expect(factor).toBeCloseTo(0.5, 2);
  });

  it('handles a long half-life (365 days)', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const factor = computeDecayFactor(thirtyDaysAgo, 365);
    // 30/365 ≈ 0.082 half-lives → 2^(-0.082) ≈ 0.945
    expect(factor).toBeCloseTo(0.945, 2);
  });

  it('never goes below 0', () => {
    const veryOld = new Date(Date.now() - 3650 * 86_400_000).toISOString();
    const factor = computeDecayFactor(veryOld, 30);
    expect(factor).toBeGreaterThanOrEqual(0);
  });

  it('clamps future dates to factor 1.0 (no boost)', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const factor = computeDecayFactor(future, 30);
    // ageMs would be negative, clamped to 0, so factor = 1.0
    expect(factor).toBeCloseTo(1.0, 5);
  });
});

describe('EVERGREEN_TAGS', () => {
  it('includes "evergreen"', () => {
    expect(EVERGREEN_TAGS.has('evergreen')).toBe(true);
  });

  it('includes "never-forget"', () => {
    expect(EVERGREEN_TAGS.has('never-forget')).toBe(true);
  });

  it('does not include arbitrary tags', () => {
    expect(EVERGREEN_TAGS.has('important')).toBe(false);
    expect(EVERGREEN_TAGS.has('learning')).toBe(false);
  });
});
