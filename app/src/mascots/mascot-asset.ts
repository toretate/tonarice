export default interface MascotAsset {
    id: string;
    name: string;
    path: string;
    /** この衣装をベースに生成した顔なし画像 */
    nofacePath?: string;
    offsetX?: number;
    offsetY?: number;
    scale?: number;
    rotation?: number;
}
