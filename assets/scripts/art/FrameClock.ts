// 序列帧的帧下标计算（纯函数，不依赖 cc）。供 FrameAnim 与单测共用。
function stepFrameAt(step: number, count: number, loop: boolean, pingpong = false): number {
    if (count <= 0) return 0;
    if (pingpong && loop && count > 1) {
        const cycle = count * 2 - 2;
        const p = ((step % cycle) + cycle) % cycle;
        return p < count ? p : cycle - p;
    }
    if (loop) return ((step % count) + count) % count;
    return Math.min(step, count - 1);
}

export function frameAt(elapsed: number, fps: number, count: number, loop: boolean, pingpong = false): number {
    return stepFrameAt(Math.floor(elapsed * fps), count, loop, pingpong);
}

export function frameBlendAt(
    elapsed: number,
    fps: number,
    count: number,
    loop: boolean,
    pingpong = false,
    blend = 0,
): { from: number; to: number; alpha: number } {
    if (count <= 0) return { from: 0, to: 0, alpha: 0 };
    const pos = Math.max(0, elapsed * fps);
    const step = Math.floor(pos);
    const from = stepFrameAt(step, count, loop, pingpong);
    const to = stepFrameAt(step + 1, count, loop, pingpong);
    const window = Math.max(0, Math.min(0.95, blend));
    if (window <= 0 || from === to) return { from, to, alpha: 0 };
    const local = pos - step;
    if (local < 1 - window) return { from, to, alpha: 0 };
    const t = (local - (1 - window)) / window;
    const alpha = t * t * (3 - 2 * t);
    return { from, to, alpha };
}
