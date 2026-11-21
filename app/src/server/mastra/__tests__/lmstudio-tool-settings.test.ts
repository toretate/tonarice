import { describe, expect, it } from 'vitest';
import { isLmStudioToolUseEnabled, setLmStudioToolUseEnabled } from '../../../utils/lmstudio-tool-settings';
import { isLmStudioTemplateError } from '../../utils/lmstudio-template-error';

describe('LM Studioのモデル別設定', () => {
    it('setLmStudioToolUseEnabled_モデルごとに無効化と再有効化を行うこと', () => {
        const disabled = setLmStudioToolUseEnabled([], ' model-a ', false);
        expect(isLmStudioToolUseEnabled(disabled, 'model-a')).toBe(false);
        expect(isLmStudioToolUseEnabled(disabled, 'model-b')).toBe(true);
        expect(setLmStudioToolUseEnabled(disabled, 'model-a', true)).toEqual([]);
        expect(setLmStudioToolUseEnabled(disabled, '', false)).toEqual(disabled);
    });

    it('isLmStudioTemplateError_循環する入れ子や無関係なエラーを安全に判別すること', () => {
        const error: { cause?: unknown; errors: unknown[] } = { errors: [{ responseBody: 'Error rendering prompt with jinja template' }] };
        error.cause = error;
        expect(isLmStudioTemplateError(error)).toBe(true);
        expect(isLmStudioTemplateError(new Error('connection refused'))).toBe(false);
    });
});
