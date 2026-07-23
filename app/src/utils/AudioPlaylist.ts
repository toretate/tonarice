import { isBinaryAudioPayload, normalizeAudioPayload, type PlayableAudio } from '../types/audio';

export class AudioPlaylist {
    private queue: PlayableAudio[] = [];
    private currentAudio: HTMLAudioElement | null = null;
    private currentObjectUrl: string | null = null;
    private isPlaying: boolean = false;
    private onSpeakingChange?: (speaking: boolean) => void;

    constructor(onSpeakingChange?: (speaking: boolean) => void) {
        this.onSpeakingChange = onSpeakingChange;
    }

    /**
     * 新しい音声データを再生キューに追加します。
     * @param audio Base64エンコードされた音声データと形式情報
     */
    public push(audio: PlayableAudio): void {
        this.queue.push(audio);
        if (!this.isPlaying) {
            this.playNext();
        }
    }

    /**
     * キューから次の音声を取り出して再生します。
     */
    private playNext(): void {
        if (this.queue.length === 0) {
            this.isPlaying = false;
            if (this.onSpeakingChange) {
                this.onSpeakingChange(false);
            }
            return;
        }

        this.isPlaying = true;
        if (this.onSpeakingChange) {
            this.onSpeakingChange(true);
        }

        const queuedAudio = this.queue.shift()!;
        try {
            const source = isBinaryAudioPayload(queuedAudio)
                ? URL.createObjectURL(queuedAudio.blob)
                : (() => {
                    const audio = normalizeAudioPayload(queuedAudio);
                    return `data:${audio.mimeType};base64,${audio.data}`;
                })();
            this.currentObjectUrl = isBinaryAudioPayload(queuedAudio) ? source : null;
            const audioElement = new Audio(source);
            this.currentAudio = audioElement;

            const finish = () => {
                if (this.currentObjectUrl === source) {
                    URL.revokeObjectURL(source);
                    this.currentObjectUrl = null;
                }
                if (this.currentAudio === audioElement) {
                    this.currentAudio = null;
                }
                this.playNext();
            };

            audioElement.onended = finish;

            audioElement.onerror = () => {
                console.error('[AudioPlaylist] 音声の再生中にエラーが発生しました');
                finish();
            };

            audioElement.play().catch((err) => {
                console.error('[AudioPlaylist] 音声再生の開始に失敗しました:', err);
                finish();
            });
        } catch (err) {
            console.error('[AudioPlaylist] Audioオブジェクト作成に失敗しました:', err);
            this.playNext();
        }
    }

    /**
     * 現在再生中の音声を停止し、キューをクリアします。
     */
    public stop(): void {
        this.queue = [];
        if (this.currentAudio) {
            try {
                this.currentAudio.pause();
                this.currentAudio.currentTime = 0;
            } catch (err) {
                // ignore
            }
            this.currentAudio = null;
        }
        if (this.currentObjectUrl) {
            URL.revokeObjectURL(this.currentObjectUrl);
            this.currentObjectUrl = null;
        }
        this.isPlaying = false;
        if (this.onSpeakingChange) {
            this.onSpeakingChange(false);
        }
    }
}
