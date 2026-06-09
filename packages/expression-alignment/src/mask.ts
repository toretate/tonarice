/**
 * step6: 楕円フェザーマスク。
 *
 * 顔は丸形であり、矩形マスクだと角に首・髪・背景が残る。
 * 検出した目中心から顔楕円を推定し、境界にフェザー（α グラデーション）を付与する。
 * マスクは共有変換 A の一部（FaceMask）としてシート単位でキャッシュされる。
 */

import type { RasterImage, FaceMask } from './types';
import { detectEyeCenters } from './feature-island-detector';

/**
 * 画像に楕円フェザーマスクを適用し、楕円外ピクセルを透明化する。
 *
 * 正規化楕円距離 d = sqrt(((x-cx)/rx)^2 + ((y-cy)/ry)^2) に基づく α 計算:
 *   d ≤ 1 - feather/min(rx,ry) : 完全不透明（alpha 変更なし）
 *   d ≥ 1                       : 完全透明（alpha = 0）
 *   その間                       : 線形補間（フェザー）
 *
 * @param image 入力 RasterImage（BFS 顔マスクや全スプライトを渡せる）
 * @param mask  楕円パラメータ（centerX/Y, radiusX/Y, feather）
 * @returns     マスク適用済みの新しい RasterImage
 */
export function applyEllipseFeatherMask(image: RasterImage, mask: FaceMask): RasterImage {
    const { width: W, height: H } = image;
    const { centerX: cx, centerY: cy, radiusX: rx, radiusY: ry, feather } = mask;
    const out = new Uint8ClampedArray(image.data);

    // feather を正規化距離に変換（feather px ÷ 短半径 で近似）
    const featherNorm = Math.max(0, feather) / Math.min(rx, ry);

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i4 = (y * W + x) * 4;
            if (out[i4 + 3] === 0) continue; // 既に透明 → スキップ

            const dxN = (x - cx) / rx;
            const dyN = (y - cy) / ry;
            const d = Math.sqrt(dxN * dxN + dyN * dyN);

            if (d >= 1) {
                out[i4 + 3] = 0;
            } else if (featherNorm > 0 && d > 1 - featherNorm) {
                // フェザー帯: 1 → 0 へ線形補間
                out[i4 + 3] = Math.round(out[i4 + 3] * ((1 - d) / featherNorm));
            }
            // d ≤ 1 - featherNorm → alpha 変更なし
        }
    }

    return { width: W, height: H, data: out };
}

/**
 * expr_*.png スプライトから顔楕円マスクパラメータを推定する。
 *
 * - detectEyeCenters で IOD（眼間距離）と目中心を取得。
 * - IOD が想定範囲（W×0.25〜W×0.55）外の場合は帽子装飾の誤検出とみなし
 *   スプライト幅ベースのフォールバックを使用する。
 *
 * 実測比率（outfit_1 正確検出3表情の平均）:
 *   radiusX = IOD × 0.78、radiusY = IOD × 0.52
 *   centerY = eyeMidY + IOD × 0.09（目中点より少し下が顔中心）
 *
 * @returns 必ず FaceMask を返す（眼検出失敗時はフォールバック値）
 */
export function estimateFaceMask(sprite: RasterImage): FaceMask {
    const { width: W, height: H, data } = sprite;

    // ラベル開始行の検出（彩度ベース: feature-island-detector と同一ロジック）
    let labelStartY = H;
    for (let y = H - 1; y >= 0; y--) {
        let nColorful = 0;
        for (let x = 0; x < W; x++) {
            const i4 = (y * W + x) * 4;
            const r = data[i4], g = data[i4 + 1], b = data[i4 + 2];
            const maxC = r > g ? (r > b ? r : b) : (g > b ? g : b);
            const minC = r < g ? (r < b ? r : b) : (g < b ? g : b);
            if (maxC - minC > 20 && maxC < 235 && maxC > 30) nColorful++;
        }
        if (nColorful / W >= 0.05) break;
        labelStartY = y;
    }

    const eyes = detectEyeCenters(sprite);

    // IOD が想定範囲内 (W×0.25〜W×0.55) の場合のみ有効な検出とみなす
    // W×0.55 超 = 帽子装飾・背景特徴を誤検出している可能性大
    const iodValid =
        eyes !== null &&
        eyes.interocularDist >= W * 0.25 &&
        eyes.interocularDist <= W * 0.55;

    let iod: number;
    let midX: number;
    let midY: number;

    if (iodValid && eyes) {
        iod = eyes.interocularDist;
        midX = eyes.midpoint.x;
        midY = eyes.midpoint.y;
    } else {
        // フォールバック: スプライト幅の 38% を IOD とし、
        // 目中点 Y はコンテンツ領域（labelStartY）の 55% と推定
        iod = W * 0.38;
        midX = W / 2;
        midY = labelStartY * 0.55;
    }

    return {
        centerX: midX,
        centerY: midY + iod * 0.09,
        radiusX: iod * 0.78,
        radiusY: iod * 0.52,
        feather: 8,
    };
}
