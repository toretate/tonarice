import { flushPromises, mount } from '@vue/test-utils';
import { expect, it, vi } from 'vitest';
import CoWorkPanel from '../CoWorkPanel.vue';

it('設定_狭いチャット領域でも上段メニューとフォームが横にはみ出さない', async () => {
    const host = document.createElement('div');
    const preferredModel = `ft:gpt-example:account:${'long-model-name-'.repeat(8)}12345678`;
    Object.assign(host.style, { container: 'chat-panel / inline-size', width: '280px', height: '590px' });
    document.body.append(host);
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
        const data = path.endsWith('/settings')
            ? { engine: 'openai', model: '', source: 'environment', hasApiKey: true, configured: false }
            : path.endsWith('/models')
                ? { models: ['gpt-example', preferredModel], preferredModel, status: 'ready' }
                : { scope: 'test-scope', account: 'account@example.test', tasks: [], runs: [] };
        return new Response(JSON.stringify(data));
    }));
    const wrapper = mount(CoWorkPanel, { attachTo: host });
    Object.assign(wrapper.element.parentElement!.style, { display: 'flex', flexDirection: 'column', height: '100%' });
    try {
        await flushPromises();
        await wrapper.get('[aria-label="設定"]').trigger('click');
        await vi.waitFor(() => {
            expect(wrapper.find<HTMLSelectElement>('select[name="model"]').element?.value).toBe(preferredModel);
        });

        const menu = wrapper.get('.cowork-sidebar').element;
        const content = wrapper.get('.cowork-content').element;
        expect(getComputedStyle(menu).position).toBe('static');
        expect(menu.getBoundingClientRect().bottom).toBeLessThanOrEqual(content.getBoundingClientRect().top + 1);
        expect(content.getBoundingClientRect().width).toBe(280);
        expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth);
    } finally {
        wrapper.unmount();
        host.remove();
        vi.unstubAllGlobals();
    }
});
