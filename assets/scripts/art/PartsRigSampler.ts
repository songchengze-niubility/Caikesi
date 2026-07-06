// PartsRig 部件缓动 · 纯函数采样器（不依赖 cc，可单测）。
// sampleAction(def, t) → 各部件相对绑定姿态的偏移 transform；cc 层/预览页只负责把结果写到节点。
import { RigActionDef, RigPartAnim, RigPartId, RigTrack, RIG_PART_IDS } from './PartsRigConfig';

export interface RigTransform {
    x: number;
    y: number;
    rot: number;      // 度，顺时针正
    scaleX: number;
    scaleY: number;
    opacity: number;  // 0..1
}

export const IDENTITY_TRANSFORM: RigTransform = { x: 0, y: 0, rot: 0, scaleX: 1, scaleY: 1, opacity: 1 };

export interface RigSample {
    root: RigTransform;
    parts: Record<RigPartId, RigTransform>;
}

type EaseName = NonNullable<RigTrack['ease']>;

const EASE: Record<EaseName, (u: number) => number> = {
    linear: (u) => u,
    sine: (u) => 0.5 - 0.5 * Math.cos(Math.PI * u),          // easeInOutSine
    quadIn: (u) => u * u,
    quadOut: (u) => 1 - (1 - u) * (1 - u),
    backOut: (u) => { const c = 1.70158; const v = u - 1; return 1 + v * v * ((c + 1) * v + c); },
};

/** 在归一化时刻 tn(0..1) 采样一条轨道；tn 越界钳制到首/末关键帧 */
export function sampleTrack(track: RigTrack, tn: number): number {
    const { times, values } = track;
    if (times.length === 0) return 0;
    if (tn <= times[0]) return values[0];
    const last = times.length - 1;
    if (tn >= times[last]) return values[last];
    let i = 0;
    while (i < last && times[i + 1] < tn) i++;
    const span = times[i + 1] - times[i];
    const u = span > 0 ? (tn - times[i]) / span : 1;
    const e = EASE[track.ease ?? 'sine'](u);
    return values[i] + (values[i + 1] - values[i]) * e;
}

function samplePartAnim(anim: RigPartAnim | undefined, tn: number): RigTransform {
    const t = { ...IDENTITY_TRANSFORM };
    if (!anim) return t;
    if (anim.x) t.x = sampleTrack(anim.x, tn);
    if (anim.y) t.y = sampleTrack(anim.y, tn);
    if (anim.rot) t.rot = sampleTrack(anim.rot, tn);
    if (anim.scaleX) t.scaleX = sampleTrack(anim.scaleX, tn);
    if (anim.scaleY) t.scaleY = sampleTrack(anim.scaleY, tn);
    if (anim.opacity) t.opacity = sampleTrack(anim.opacity, tn);
    return t;
}

export function sampleAction(def: RigActionDef, timeSec: number): RigSample {
    const raw = timeSec / def.duration;
    const tn = def.loop
        ? ((raw % 1) + 1) % 1                 // 负时间也安全的循环取模
        : Math.min(Math.max(raw, 0), 1);      // 非循环钳制在末姿态
    const parts = {} as Record<RigPartId, RigTransform>;
    for (const p of RIG_PART_IDS) parts[p] = samplePartAnim(def.parts[p], tn);
    return { root: samplePartAnim(def.root, tn), parts };
}
