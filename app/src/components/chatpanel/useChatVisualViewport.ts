import { nextTick, onMounted, onUnmounted } from 'vue';

export const isTextEntryElement = (element: Element | null): boolean => {
    return element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLElement && element.isContentEditable === true;
};

export const useChatVisualViewport = (scrollToBottom: () => void): void => {
    const keepLatestMessageVisible = () => {
        if (!isTextEntryElement(document.activeElement)) return;
        nextTick(scrollToBottom);
    };

    onMounted(() => {
        window.visualViewport?.addEventListener('resize', keepLatestMessageVisible);
    });

    onUnmounted(() => {
        window.visualViewport?.removeEventListener('resize', keepLatestMessageVisible);
    });
};
