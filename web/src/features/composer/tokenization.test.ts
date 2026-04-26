import { describe, expect, test } from 'vitest';
import {
  extractCompletionToken,
  extractTaggedFiles,
  formatAtInsertion,
  parseTriggerState,
} from './tokenization';

describe('tokenization', () => {
  test('parses quoted @ trigger', () => {
    const input = 'open @"docs/read me.md"';
    const cursor = input.length;
    const state = parseTriggerState(input, cursor);
    expect(state?.trigger).toBe('@');
    expect(state?.query).toBe('docs/read me.md');
    expect(state?.quoted).toBe(true);
  });

  test('extracts slash token at cursor', () => {
    const token = extractCompletionToken('hello /rea', 'hello /rea'.length);
    expect(token?.token).toBe('/rea');
  });

  test('extracts tagged files including quoted', () => {
    const tagged = extractTaggedFiles('read @src/index.ts and @"docs/read me.md"');
    expect(tagged).toEqual(['src/index.ts', 'docs/read me.md']);
  });

  test('formats quoted insertion when needed', () => {
    expect(formatAtInsertion('docs/read me.md')).toBe('@"docs/read me.md"');
    expect(formatAtInsertion('src/index.ts')).toBe('@src/index.ts');
  });
});
