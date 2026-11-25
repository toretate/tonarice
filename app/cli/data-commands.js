import { CliError } from './main.js';

export async function handleDataCommand(line, client, output) {
    const match = /^\/(memo|todo)(?:\s+(.*))?$/.exec(line);
    if (!match) return false;
    const [, kind, rest = ''] = match;
    const label = kind === 'memo' ? 'メモ' : 'タスク';
    const [action = 'list', ...parts] = rest.trim().split(/\s+/).filter(Boolean);
    if (action === 'help') {
        output.write(`/${kind} list | add 内容 | edit ID 内容 | delete ID${kind === 'todo' ? ' | done ID | reopen ID' : ''}\n`);
        return true;
    }
    if (action === 'list' && parts.length === 0) {
        const result = await client.listData(kind);
        const items = kind === 'memo' ? result.memos : result.tasks;
        if (!Array.isArray(items)) throw new CliError('server_error', `${label}一覧の応答が不正です。`, 6);
        output.write(items.length ? `${items.map(item => kind === 'memo' ? `${item.id}: ${item.content}` : `${item.id}: [${item.completed ? '済' : '未'}] ${item.title}`).join('\n')}\n` : `${label}はありません。\n`);
        output.write(`操作一覧: /${kind} help\n`);
        return true;
    }
    let payload;
    if (action === 'add' && parts.length) payload = { kind, action: 'add', text: parts.join(' ') };
    else if (action === 'edit' && parts.length >= 2) payload = { kind, action: 'update', id: parts[0], text: parts.slice(1).join(' ') };
    else if (action === 'delete' && parts.length === 1) payload = { kind, action: 'delete', id: parts[0] };
    else if (kind === 'todo' && ['done', 'reopen'].includes(action) && parts.length === 1) payload = { kind, action: 'update', id: parts[0], completed: action === 'done' };
    else { output.write(`操作が不正です。/${kind} help を参照してください。\n`); return true; }
    const result = await client.updateData(payload);
    if (result.success !== true) throw new CliError('server_error', `${label}を更新できませんでした。`, 6);
    output.write(`${label}を更新しました${result.id ? `（ID: ${result.id}）` : ''}。\n`);
    return true;
}
