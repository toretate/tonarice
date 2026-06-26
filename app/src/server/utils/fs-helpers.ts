import * as fs from 'fs';
import * as path from 'path';

/**
 * 一時ファイルを経由して安全にファイルへ書き込みを行う（アトミック書き込み）
 */
export function safeWriteFileSync(filePath: string, data: string, encoding: BufferEncoding = 'utf8'): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, data, encoding);
    fs.renameSync(tmpPath, filePath);
}
