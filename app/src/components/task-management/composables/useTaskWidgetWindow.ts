import { computed, onMounted, onUnmounted, ref, type Ref } from 'vue';
import { useConfigStore } from '../../../store/config';
import { useTaskStore } from '../../../store/task';
import { useResizableFrame } from '../../../composables/useResizableFrame';
import { useSmartphoneLayout } from '../../../composables/useSmartphoneLayout';

export const useTaskWidgetWindow = (
    taskStore: ReturnType<typeof useTaskStore>,
    configStore: ReturnType<typeof useConfigStore>,
    windowMode: Ref<string>
) => {
    const posX = ref(Math.max(10, window.innerWidth - 350));
    const posY = ref(80);
    const width = ref(340);
    const height = ref(480);
    const isLocalDragging = ref(false);
    const { isSmartphoneLayout } = useSmartphoneLayout();

    const isCompactOverlay = computed(() => {
        return windowMode.value === 'compact' ||
            window.location.hash === '#compact' ||
            isSmartphoneLayout.value;
    });

    let localDragStartX = 0;
    let localDragStartY = 0;
    let isElectronDragging = false;
    let electronDragStartX = 0;
    let electronDragStartY = 0;

    const { initResize } = useResizableFrame({
        minWidth: 300,
        minHeight: 350,
        getStartSize: () => ({ width: width.value, height: height.value }),
        onResizeApply: (nextWidth, nextHeight) => {
            width.value = nextWidth;
            height.value = nextHeight;
            if (windowMode.value !== 'integrated' && windowMode.value !== 'compact') {
                window.electronAPI?.resizeWindow?.({ width: nextWidth, height: nextHeight });
            }
        }
    });

    const onLocalPointerMove = (event: PointerEvent) => {
        if (!isLocalDragging.value) return;
        const x = event.clientX - localDragStartX;
        const y = event.clientY - localDragStartY;
        posX.value = Math.max(10, Math.min(Math.max(10, window.innerWidth - width.value - 10), x));
        posY.value = Math.max(10, Math.min(Math.max(10, window.innerHeight - height.value - 10), y));
    };

    const onLocalPointerUp = () => {
        if (!isLocalDragging.value) return;
        isLocalDragging.value = false;
        window.removeEventListener('pointermove', onLocalPointerMove);
        window.removeEventListener('pointerup', onLocalPointerUp);
        window.removeEventListener('pointercancel', onLocalPointerUp);
        localStorage.setItem('task_widget_pos_x', posX.value.toString());
        localStorage.setItem('task_widget_pos_y', posY.value.toString());
    };

    const onElectronPointerUp = () => {
        if (!isElectronDragging) return;
        isElectronDragging = false;
        window.removeEventListener('pointermove', onElectronPointerMove);
        window.removeEventListener('pointerup', onElectronPointerUp);
        window.removeEventListener('pointercancel', onElectronPointerUp);
        window.electronAPI?.dragWindow?.({ dx: 0, dy: 0, isEnd: true });
    };

    const onElectronPointerMove = (event: PointerEvent) => {
        if (!isElectronDragging) return;
        if (event.pointerType === 'mouse' && event.buttons !== 1) {
            onElectronPointerUp();
            return;
        }

        const dx = event.screenX - electronDragStartX;
        const dy = event.screenY - electronDragStartY;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
            window.electronAPI?.dragWindow?.({ dx, dy });
            electronDragStartX = event.screenX;
            electronDragStartY = event.screenY;
        }
    };

    const startWidgetDrag = (event: PointerEvent) => {
        const target = event.target as HTMLElement;
        if (
            !event.isPrimary ||
            event.button !== 0 ||
            target.closest('button') ||
            target.closest('input') ||
            target.closest('.category-tabs') ||
            target.closest('.completion-progress') ||
            target.closest('.view-selector') ||
            target.closest('.resize-handle')
        ) return;

        event.preventDefault();
        if (windowMode.value === 'integrated') {
            isLocalDragging.value = true;
            localDragStartX = event.clientX - posX.value;
            localDragStartY = event.clientY - posY.value;
            window.addEventListener('pointermove', onLocalPointerMove);
            window.addEventListener('pointerup', onLocalPointerUp);
            window.addEventListener('pointercancel', onLocalPointerUp);
        } else if (window.electronAPI?.dragWindow) {
            isElectronDragging = true;
            electronDragStartX = event.screenX;
            electronDragStartY = event.screenY;
            window.electronAPI.dragWindow({ dx: 0, dy: 0, isStart: true });
            window.addEventListener('pointermove', onElectronPointerMove);
            window.addEventListener('pointerup', onElectronPointerUp);
            window.addEventListener('pointercancel', onElectronPointerUp);
        }
    };

    const closeWidget = () => {
        taskStore.showTaskWidget = false;
        if (windowMode.value !== 'integrated' && windowMode.value !== 'compact') {
            window.electronAPI?.toggleTasks?.();
        }
    };

    const widgetStyle = computed(() => {
        const opacity = configStore.taskOpacity ?? 1;
        if (
            window.location.hash === '#tasks' ||
            isCompactOverlay.value
        ) {
            return { width: '100%', height: '100%', opacity };
        }

        return {
            position: 'absolute' as const,
            left: `${posX.value}px`,
            top: `${posY.value}px`,
            width: `${width.value}px`,
            height: `${height.value}px`,
            opacity,
            zIndex: 100
        };
    });

    onMounted(() => {
        const savedX = Number.parseInt(localStorage.getItem('task_widget_pos_x') ?? '', 10);
        const savedY = Number.parseInt(localStorage.getItem('task_widget_pos_y') ?? '', 10);
        const maxX = Math.max(10, window.innerWidth - width.value - 10);
        const maxY = Math.max(10, window.innerHeight - height.value - 10);
        posX.value = Number.isNaN(savedX) ? maxX : Math.max(10, Math.min(maxX, savedX));
        posY.value = Number.isNaN(savedY) ? Math.min(80, maxY) : Math.max(10, Math.min(maxY, savedY));
    });

    onUnmounted(() => {
        onLocalPointerUp();
        onElectronPointerUp();
    });

    return {
        widgetStyle,
        isCompactOverlay,
        startWidgetDrag,
        initResize,
        closeWidget
    };
};
