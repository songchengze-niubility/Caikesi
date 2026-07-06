// PartsRig 部件缓动 · 参数数据表（纯数据，不依赖 cc）。
// 标准部件规范 v1（2026-07-05 设计规范，用户定）：所有角色统一 8 件、同锚点语义、同父子链，
// 因此动作参数全角色共享，个别角色可整组覆盖。设计见 docs/superpowers/specs/2026-07-05-partsrig-design.md。

export type RigPartId =
    | 'hairBack'   // 后发/马尾（扎发点）
    | 'head'       // 头+前发（脖颈）
    | 'torso'      // 躯干+衣袍（领口）
    | 'armFront'   // 持械臂（肩）
    | 'armBack'    // 后臂（肩）
    | 'legFront'   // 前腿（袍摆/裤脚口）
    | 'legBack'    // 后腿（袍摆/裤脚口）
    | 'weapon';    // 武器（握把）
export type RigActionId = 'idle' | 'run' | 'attack' | 'death';

export const RIG_PART_IDS: RigPartId[] = ['hairBack', 'head', 'torso', 'armFront', 'armBack', 'legFront', 'legBack', 'weapon'];
export const RIG_ACTION_IDS: RigActionId[] = ['idle', 'run', 'attack', 'death'];

/** 关键帧轨道：times 为 0..1 归一化时刻，values 与之等长；ease 为相邻两帧间的缓动 */
export interface RigTrack {
    times: number[];
    values: number[];
    ease?: 'linear' | 'sine' | 'quadIn' | 'quadOut' | 'backOut';
}

/** 单部件在一个动作里的通道集合；未定义的通道 = 恒等（不动） */
export interface RigPartAnim {
    x?: RigTrack;
    y?: RigTrack;
    rot?: RigTrack;
    scaleX?: RigTrack;
    scaleY?: RigTrack;
    opacity?: RigTrack;
}

export interface RigActionDef {
    duration: number;   // 秒
    loop: boolean;
    parts: Partial<Record<RigPartId, RigPartAnim>>;
    root?: RigPartAnim; // 整体容器（倒地/淡出用）
}

/** 部件绑定姿态：位置相对脚底原点（x 右正 / y 上正，120px 角色坐标系），z 越大越靠前 */
export interface RigBindDef {
    x: number;
    y: number;
    z: number;
    /** 基础旋转角（度，屏幕顺时针正），动画 rot 叠加其上（真图素材的基础角在组装时已烘进像素，恒为 0） */
    rot?: number;
    /** 色块 demo 的画法：down=从锚点垂下 / up=从锚点向上 / fwd=从锚点向前 / circle=圆心在锚点上方 */
    draw: 'up' | 'down' | 'fwd' | 'circle';
    w: number;
    h: number;
    color: string;
}

/** idle/run 里部件位移振幅上限（px）：遮挡余量红线，防拆件断口露馅（spec 第 5 节） */
export const RIG_MAX_PART_OFFSET = 14;

/** 父子链（标准骨架，全角色一致）：父级旋转/缩放/位移带动子级 */
export const RIG_PARENTS: Record<RigPartId, RigPartId | 'root'> = {
    torso: 'root',
    head: 'torso',
    hairBack: 'head',
    armFront: 'torso',
    armBack: 'torso',
    legFront: 'root',   // 腿挂 root：脚踩地，不随上身前倾/呼吸弹跳漂移
    legBack: 'root',
    weapon: 'armFront',
};

// 色块 demo 布局（真图的绑定由组装 meta 换算，此表只服务无图调试）
export const PartsRigBind: Record<RigPartId, RigBindDef> = {
    hairBack: { x: -18, y: 102, z: 1, rot: 22, draw: 'down', w: 14, h: 50, color: '#33363c' },
    armBack:  { x: -5,  y: 65,  z: 2, draw: 'down',   w: 9,  h: 26, color: '#d8d2c0' },
    legBack:  { x: -8,  y: 22,  z: 3, draw: 'down',   w: 10, h: 22, color: '#8f9c7f' },
    legFront: { x: 10,  y: 22,  z: 4, draw: 'down',   w: 10, h: 22, color: '#9dab8b' },
    torso:    { x: 0,   y: 44,  z: 5, draw: 'up',     w: 30, h: 30, color: '#96a58c' },
    head:     { x: 3,   y: 66,  z: 6, draw: 'circle', w: 40, h: 40, color: '#e8d9c3' },
    armFront: { x: 11,  y: 65,  z: 7, draw: 'down',   w: 9,  h: 26, color: '#e2dcc8' },
    weapon:   { x: 17,  y: 40,  z: 8, draw: 'fwd',    w: 46, h: 6,  color: '#7f958f' },
};

// 动作参数在 parts.actions.generated.ts（真源=动作编辑器，npm run rig:editor / rig:import）
export { PartsRigActions } from './parts.actions.generated';
