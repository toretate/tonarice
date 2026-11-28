// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, expect, test, vi } from 'vitest';
import PromptEditorModal from '../mascot/PromptEditorModal.vue';
import { loadMascotPrompts, saveMascotPrompts } from '../../../utils/mascot-prompt-client';
import { changeCompanionMemory, loadCompanionMemory } from '../../../utils/companion-memory-client';

vi.mock('../../../utils/mascot-prompt-client', () => ({
    loadMascotPrompts: vi.fn(), saveMascotPrompts: vi.fn(), previewLocalLegacyMascotPrompts: vi.fn()
}));
vi.mock('../../../utils/companion-memory-client', () => ({
    loadCompanionMemory: vi.fn(), changeCompanionMemory: vi.fn()
}));

const prompts = { identity: '', soul: '', user: '', agents: '', memory: 'Undo 前の記憶' };
function mountEditor() {
    return mount(PromptEditorModal, {
        props: { visible: true, mascotId: 'mascot' },
        global: { stubs: {
            AppModalShell: { template: '<div><slot /></div>' },
            Button: { props: ['label', 'disabled'], template: '<button :disabled="disabled">{{ label }}</button>' }
        } }
    });
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadMascotPrompts)
        .mockResolvedValueOnce({ prompts, revision: 'before', configured: true })
        .mockResolvedValue({ prompts: { ...prompts, memory: 'Undo 後の記憶' }, revision: 'after', configured: true });
    vi.mocked(loadCompanionMemory).mockResolvedValue({
        enabled: true, reasons: [], concerns: [], revision: { id: 'undo-id', timestamp: 1 }
    });
    vi.mocked(changeCompanionMemory).mockResolvedValue({ enabled: true, reasons: [], concerns: [] });
});

test('PromptEditorModal_Undo後に未編集なら欄と版を同期して保存できる', async () => {
    const wrapper = mountEditor();
    await flushPromises();
    await wrapper.findAll('button').find(button => button.text() === '前回の記憶更新を元に戻す')!.trigger('click');
    await flushPromises();
    expect((wrapper.findAll('textarea').at(-1)!.element as HTMLTextAreaElement).value).toBe('Undo 後の記憶');
    await wrapper.findAll('button').find(button => button.text() === '保存する')!.trigger('click');
    await flushPromises();
    expect(saveMascotPrompts).toHaveBeenCalledWith('mascot', { ...prompts, memory: 'Undo 後の記憶' }, 'after');
    wrapper.unmount();
});

test('PromptEditorModal_Undo後も未保存の編集を残して再読み込みを案内する', async () => {
    const wrapper = mountEditor();
    await flushPromises();
    const memory = wrapper.findAll('textarea').at(-1)!;
    await memory.setValue('未保存の編集');
    await wrapper.findAll('button').find(button => button.text() === '前回の記憶更新を元に戻す')!.trigger('click');
    await flushPromises();
    expect((memory.element as HTMLTextAreaElement).value).toBe('未保存の編集');
    expect(loadMascotPrompts).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('保存する前に最新のプロンプトを読み込んでください');
    expect(wrapper.findAll('button').find(button => button.text() === '保存する')!.attributes('disabled')).toBeDefined();
    wrapper.unmount();
});
