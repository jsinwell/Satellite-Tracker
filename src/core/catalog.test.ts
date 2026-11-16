import { describe, expect, it } from 'vitest';
import { fixtures } from './__fixtures__/satellites';
import { CATALOG_SCHEMA_VERSION, CatalogError, parseCatalog } from './catalog';

const valid = {
  schemaVersion: CATALOG_SCHEMA_VERSION,
  generatedAt: '2026-11-16T06:26:24.665Z',
  source: 'test',
  satellites: fixtures,
};

describe('parseCatalog', () => {
  it('accepts a well-formed catalog', () => {
    expect(parseCatalog(valid).satellites).toHaveLength(fixtures.length);
  });

  it.each([
    ['a non-object', 'not a catalog'],
    ['null', null],
    ['an unknown schema version', { ...valid, schemaVersion: 2 }],
    ['a missing generation time', { ...valid, generatedAt: undefined }],
    ['an unparseable generation time', { ...valid, generatedAt: 'yesterday' }],
    ['no satellites', { ...valid, satellites: [] }],
    ['malformed records', { ...valid, satellites: [{ name: 'NO ID' }] }],
  ])('rejects %s', (_label, input) => {
    expect(() => parseCatalog(input)).toThrow(CatalogError);
  });
});
