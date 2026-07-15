import { describe, expect, test } from 'vitest';
import {
    extractEnglishTermsForTtsDictionary,
    isValidTtsDictionaryValue
} from '../tts-dictionary';

describe('TTS辞書ユーティリティ', () => {
    test('extractEnglishTermsForTtsDictionary - 技術用語を重複なく抽出すること', () => {
        expect(extractEnglishTermsForTtsDictionary(
            'BiomeとBIOME、ESLint、C++、C#、CI/CD、Node.js。'
        )).toEqual(['Biome', 'ESLint', 'C++', 'C#', 'CI/CD', 'Node.js']);
    });

    test('extractEnglishTermsForTtsDictionary - 空文字と件数上限を扱えること', () => {
        expect(extractEnglishTermsForTtsDictionary('')).toEqual([]);
        expect(extractEnglishTermsForTtsDictionary('one two three', 2)).toEqual(['one', 'two']);
    });

    test('isValidTtsDictionaryValue - 日本語の読みのみを許可すること', () => {
        expect(isValidTtsDictionaryValue('バイオーム')).toBe(true);
        expect(isValidTtsDictionaryValue('シーアイ・シーディー')).toBe(true);
        expect(isValidTtsDictionaryValue('Biome')).toBe(false);
        expect(isValidTtsDictionaryValue('')).toBe(false);
    });
});
