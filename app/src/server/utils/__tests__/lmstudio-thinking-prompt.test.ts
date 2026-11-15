import { describe, expect, it } from 'vitest';
import { stripNoThinkDirective } from '../lmstudio-thinking-prompt';

describe('LM Studio思考切替プロンプトのテスト', () => {
    it('stripNoThinkDirective_履歴から単独の指示を除去すること', () => {
        expect(stripNoThinkDirective('前の質問\n/no_think')).toBe('前の質問');
        expect(stripNoThinkDirective('/no_think 次の質問 /NO_THINK')).toBe('次の質問');
        expect(stripNoThinkDirective('prefix/no_thinking')).toBe('prefix/no_thinking');
        expect(stripNoThinkDirective('    コードのインデント  ')).toBe('    コードのインデント  ');
    });

});
