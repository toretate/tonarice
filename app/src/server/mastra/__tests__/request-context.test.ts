import { describe, expect, it } from 'vitest';
import { createMascotRequestContext } from '../request-context';

class SecretBearingModel {
    public constructor(private readonly apiKey: string) {}
}

describe('createMascotRequestContextのテスト', () => {
    it('createMascotRequestContext_モデル内部のAPIキーをスパンへ展開しないこと', () => {
        const requestContext = createMascotRequestContext({
            resolvedModel: new SecretBearingModel('secret-api-key'),
            engine: 'gemini',
            modelId: 'gemini-test'
        });

        const serialized = JSON.stringify(requestContext.serializeForSpan());

        expect(serialized).toContain('gemini-test');
        expect(serialized).not.toContain('secret-api-key');
    });
});
