import { tool } from '@lmstudio/sdk';
import { z } from 'zod';

export const manageMemos = tool({
    name: 'manageMemos',
    description: '期限のない自由メモ・覚え書きの追加・検索・更新・削除を行う。買い物リストや思いつき等、後から一覧で見返したいがスケジュール管理の不要なものに使う。期限付きの予定/TODO は manageTasks、その場限りの一度きり通知はタイマーを使うこと（混同しない）。\n【IDの指定】更新（update）や削除（delete）を行う際は、操作対象のメモIDが不明な場合のみ事前に検索（search）を実行し、検索結果に表示された一意の ID（例: `memo_xxxx`）を特定して `id` パラメータに指定してください。ユーザーから ID が直接提示された場合は、事前検索を行わずにその ID を直接 `id` パラメータに指定してください。メモ本文などのテキストを `id` に指定してはいけません。',
    parameters: {
        action: z.enum(['add', 'search', 'update', 'delete']).describe('操作種別。add=追加、search=検索、update=更新、delete=削除'),
        content: z.string().optional().describe('メモ本文（add時は必須）'),
        id: z.string().optional().describe('操作対象のメモID（update・delete 時は必須）。※操作対象の ID が不明な場合のみ事前に検索（search）を行い、検索結果に含まれる一意の ID（例: `memo_xxxx`）をそのまま指定してください。ユーザーから ID が直接提示された場合は、検索を行わずにその ID を直接指定してください。メモの本文などのテキストを id に指定してはいけません。複数件を操作する場合は、それぞれ個別に ID を指定してアクションを実行してください。'),
        query: z.string().optional().describe('本文の検索キーワード（search時）'),
        color: z.string().optional().describe('付箋色（任意）'),
        pinned: z.boolean().optional().describe('ピン留め（任意）')
    },
    // 実際の処理はサーバー側で行うためスタブ
    implementation: async (params) => {
        return params;
    }
});
