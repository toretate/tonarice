import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { PYTHON_DIR, resolveMascotPath } from './paths';

const execFileAsync = promisify(execFile);

const PYTHON_BIN = process.env.REMBG_PYTHON
    ?? path.join(PYTHON_DIR, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');

const NOFACE_SCRIPT = path.join(PYTHON_DIR, 'generate_noface.py');
const RETOUCH_SCRIPT = path.join(PYTHON_DIR, 'retouch.py');

function resolveImagePath(imagePath: string): string {
    if (imagePath.startsWith('/mascots/')) {
        return resolveMascotPath(imagePath);
    }
    return imagePath;
}

/**
 * のっぺらぼう画像を自動生成する。
 */
export async function generateNofaceImage(inputPath: string, outputPath: string): Promise<string> {
    const absInput = resolveImagePath(inputPath);
    const absOutput = resolveImagePath(outputPath);

    // 出力先ディレクトリの確保
    fs.mkdirSync(path.dirname(absOutput), { recursive: true });

    if (!fs.existsSync(absInput)) {
        throw new Error(`Input image not found: ${absInput}`);
    }

    const { stdout } = await execFileAsync(
        PYTHON_BIN,
        [NOFACE_SCRIPT, absInput, absOutput],
        { timeout: 30_000 }
    );

    const result = JSON.parse(stdout.trim()) as { success: boolean; outputPath?: string; error?: string };
    if (!result.success || result.error) {
        throw new Error(`generate_noface failed: ${result.error}`);
    }

    return outputPath;
}

/**
 * 手動レタッチを適用する。
 */
export async function applyRetouch(
    inputPath: string,
    outputPath: string,
    tool: 'brush' | 'eraser',
    x: number,
    y: number,
    radius: number
): Promise<string> {
    const absInput = resolveImagePath(inputPath);
    const absOutput = resolveImagePath(outputPath);

    fs.mkdirSync(path.dirname(absOutput), { recursive: true });

    if (!fs.existsSync(absInput)) {
        throw new Error(`Input image not found: ${absInput}`);
    }

    const { stdout } = await execFileAsync(
        PYTHON_BIN,
        [RETOUCH_SCRIPT, absInput, absOutput, tool, String(x), String(y), String(radius)],
        { timeout: 10_000 }
    );

    const result = JSON.parse(stdout.trim()) as { success: boolean; outputPath?: string; error?: string };
    if (!result.success || result.error) {
        throw new Error(`retouch failed: ${result.error}`);
    }

    return outputPath;
}

const ALIGN_SCRIPT = path.join(PYTHON_DIR, 'align_expression.py');

/**
 * のっぺらぼう画像と表情パーツ自動位置合わせを行う。
 */
export async function alignExpression(
    basePath: string,
    expressionPath: string,
    detectMode = 'ai'
): Promise<{ success: boolean; offsetX: number; offsetY: number; scale: number; exprMidX: number; exprMidY: number; exprOvalCX: number; exprOvalCY: number; exprEyeDist: number; exprOvalW: number; baseWidth?: number; baseHeight?: number; exprWidth?: number; exprHeight?: number; error?: string }> {
    const absBase = resolveImagePath(basePath);
    const absExpr = resolveImagePath(expressionPath);

    if (!fs.existsSync(absBase)) {
        throw new Error(`Base image not found: ${absBase}`);
    }
    if (!fs.existsSync(absExpr)) {
        throw new Error(`Expression image not found: ${absExpr}`);
    }

    const { stdout } = await execFileAsync(
        PYTHON_BIN,
        [ALIGN_SCRIPT, '--base', absBase, '--expression', absExpr, '--mode', detectMode],
        { timeout: 30_000 }
    );

    const result = JSON.parse(stdout.trim());
    return result;
}

const DETECT_FACE_SCRIPT = path.join(PYTHON_DIR, 'detect_base_face.py');

/**
 * 元の立ち絵画像から顔領域を自動検出する。
 */
export async function detectBaseFace(
    imagePath: string,
    detectMode = 'ai'
): Promise<{ success: boolean; fallback: boolean; faceX: number; faceY: number; faceWidth: number; faceHeight: number; baseWidth: number; baseHeight: number; error?: string }> {
    const absPath = resolveImagePath(imagePath);

    if (!fs.existsSync(absPath)) {
        throw new Error(`Target image not found: ${absPath}`);
    }

    const { stdout } = await execFileAsync(
        PYTHON_BIN,
        [DETECT_FACE_SCRIPT, '--image', absPath, '--mode', detectMode],
        { timeout: 30_000 }
    );

    const result = JSON.parse(stdout.trim());
    return result;
}
