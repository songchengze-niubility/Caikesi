// 序列帧的帧下标计算（纯函数，不依赖 cc）。供 FrameAnim 与单测共用。
export function frameAt(elapsed: number, fps: number, count: number, loop: boolean): number {
    if (count <= 0) return 0;
    const i = Math.floor(elapsed * fps);
    if (loop) return ((i % count) + count) % count;
    return Math.min(i, count - 1);
}
