import { describe, expect, it } from 'vitest';
import { canonicalJson, sameJson } from './json';

describe('canonical JSON', () => {
  it('ignores the order of keys at every depth, keeps the order of arrays', () => {
    expect(sameJson({ a: 1, b: { c: [1, { d: 2, e: 3 }] } }, { b: { c: [1, { e: 3, d: 2 }] }, a: 1 })).toBe(true);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
    expect(sameJson({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(canonicalJson({ b: 1, a: null })).toBe('{"a":null,"b":1}');
  });
});
