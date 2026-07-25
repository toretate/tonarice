// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import MessageList from '../MessageList.vue';

describe('MessageList TTS読み辞書メニュー', () => {
    afterEach(() => {
        vi.useRealTimers();
        window.getSelection()?.removeAllRanges();
    });

    test('handleContextMenu - AIメッセージの選択部分を読み登録イベントで送ること', async () => {
        const wrapper = mount(MessageList, {
            props: {
                messages: [{ id: 1, sender: 'mascot', text: 'BiomeとESLintを比較する' }],
                isSecretMode: false
            },
            attachTo: document.body,
            global: { stubs: { Teleport: true } }
        });
        const textElement = wrapper.find('.message-text').element;
        const textNode = textElement.querySelector('p span')!.firstChild!;
        const range = document.createRange();
        range.setStart(textNode, 0);
        range.setEnd(textNode, 5);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);

        await wrapper.find('.bubble').trigger('contextmenu', { clientX: 10, clientY: 10 });
        const dictionaryItem = wrapper.findAll('.menu-item').find(item => item.text().includes('英単語読みを辞書登録'));
        expect(dictionaryItem).toBeDefined();
        await dictionaryItem!.trigger('click');

        expect(wrapper.emitted('register-tts-readings')).toEqual([['Biome']]);
        wrapper.unmount();
    });

    test('handleContextMenu - ユーザーメッセージには読み登録メニューを表示しないこと', async () => {
        const wrapper = mount(MessageList, {
            props: {
                messages: [{ id: 1, sender: 'user', text: 'Biome' }],
                isSecretMode: false
            },
            global: { stubs: { Teleport: true } }
        });
        await wrapper.find('.bubble').trigger('contextmenu', { clientX: 10, clientY: 10 });
        expect(wrapper.text()).not.toContain('英単語読みを辞書登録');
    });

    test('handlePointerDown - contextmenuがなくても右ボタンでメニューを開けること', async () => {
        const wrapper = mount(MessageList, {
            props: {
                messages: [{ id: 1, sender: 'mascot', text: 'Biome' }],
                isSecretMode: false
            },
            global: { stubs: { Teleport: true } }
        });

        await wrapper.find('.bubble').trigger('pointerdown', { button: 2, clientX: 10, clientY: 10 });
        expect(wrapper.text()).toContain('英単語読みを辞書登録');
    });

    test('replay-tts - AIメッセージの再送ボタンから本文を送ること', async () => {
        const wrapper = mount(MessageList, {
            props: {
                messages: [{ id: 1, sender: 'mascot', text: 'Biomeを再生する。' }],
                isSecretMode: false
            }
        });

        await wrapper.find('.replay-tts-btn').trigger('click');
        expect(wrapper.emitted('replay-tts')).toEqual([['Biomeを再生する。']]);
    });

    test('retry-message - 送信失敗したユーザーバブルをエラー表示して再送IDを送ること', async () => {
        const wrapper = mount(MessageList, {
            props: {
                messages: [{
                    id: 42,
                    sender: 'user',
                    text: '送信できなかったメッセージ',
                    deliveryStatus: 'failed',
                    deliveryError: 'ネットワークエラー'
                }],
                isSecretMode: false
            }
        });

        expect(wrapper.find('.message-row').classes()).toContain('delivery-failed');
        expect(wrapper.text()).toContain('送信失敗');
        await wrapper.find('.retry-message-btn').trigger('click');
        expect(wrapper.emitted('retry-message')).toEqual([[42]]);
    });

    test('MarkdownMessage - AI返答の見出し・強調・箇条書きを装飾して表示すること', () => {
        const wrapper = mount(MessageList, {
            props: {
                messages: [{
                    id: 1,
                    sender: 'mascot',
                    text: '### 🎯 主な特徴\n\n**SBOM** で管理します。\n\n- 脆弱性を検出\n- リスクを管理'
                }],
                isSecretMode: false
            }
        });

        expect(wrapper.find('h3').text()).toBe('🎯 主な特徴');
        expect(wrapper.find('strong').text()).toBe('SBOM');
        expect(wrapper.findAll('li').map(item => item.text())).toEqual(['脆弱性を検出', 'リスクを管理']);
        expect(wrapper.text()).not.toContain('###');
        expect(wrapper.text()).not.toContain('**');
    });

    test('formatMessageTime_到着日と現在日の関係に応じた形式で表示すること', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 6, 25, 12, 0));
        const wrapper = mount(MessageList, {
            props: {
                messages: [
                    { id: 1, sender: 'mascot', text: '今日', timestamp: new Date(2026, 6, 25, 9, 7).getTime() },
                    { id: 2, sender: 'mascot', text: '同月', timestamp: new Date(2026, 6, 23, 9, 7).getTime() },
                    { id: 3, sender: 'mascot', text: '別月', timestamp: new Date(2026, 5, 30, 9, 7).getTime() },
                    { id: 4, sender: 'mascot', text: '別年', timestamp: new Date(2025, 11, 31, 9, 7).getTime() }
                ],
                isSecretMode: false
            }
        });

        const times = wrapper.findAll('time.message-timestamp');
        expect(times.map(time => time.text())).toEqual([
            '09:07',
            '07/23 09:07',
            '06/30',
            '2025/12/31'
        ]);
        expect(times.map(time => time.attributes('title'))).toEqual([
            '2026/07/25 09:07',
            '2026/07/23 09:07',
            '2026/06/30 09:07',
            '2025/12/31 09:07'
        ]);
        expect(times[0].attributes('datetime')).toBe(new Date(2026, 6, 25, 9, 7).toISOString());
    });
});
