// Art manifest: logical keys -> resources under assets/resources.
// Paths are relative to resources/ and do not include file extensions.
// frames 可选身体基准（sprite-keyframe 导入工具自动计算，均为 0-1 归一化）：
//   bodyH   身体高/帧高（逐帧 alpha bbox 高的中位数）。游戏侧按它把「身体」而不是「整帧」缩放到职业目标高，
//           否则各动作按自身裁切框归一会导致切动作时身体忽大忽小。
//   anchorX 脚接触点 X/帧宽（脚底接触像素质心的中位数）。用于把角色脚点对齐到单位坐标，切动作不横移。
//   footY   身体底 Y/帧高（alpha bbox 底边的中位数）。用于把脚对齐到地面线，切动作不上下跳。
// 不填 = 旧行为（整帧缩放、中心对齐），老资源无需迁移。
export type ArtEntry =
    | { type: 'sprite'; path: string }
    | {
        type: 'frames'; dir: string; prefix?: string; frames: number; fps: number; loop: boolean;
        pingpong?: boolean; blend?: number; bodyH?: number; anchorX?: number; footY?: number;
    };

export const ArtManifest: Record<string, ArtEntry> = {
    'bg/main':          { type: 'sprite', path: 'art/bg/main' },
    'bg/main-v02/sky':           { type: 'sprite', path: 'art/bg/main-v02/sky' },
    'bg/main-v02/far':           { type: 'sprite', path: 'art/bg/main-v02/far_mountains' },
    'bg/main-v02/mid':           { type: 'sprite', path: 'art/bg/main-v02/mid_mountains' },
    'bg/main-v02/ground':        { type: 'sprite', path: 'art/bg/main-v02/ground' },
    'bg/main-v02/mist':          { type: 'sprite', path: 'art/bg/main-v02/mist' },
    'bg/main-v02/foreground':    { type: 'sprite', path: 'art/bg/main-v02/foreground' },
    'char/tank/idle':   { type: 'frames', dir: 'art/char/tank/idle',   frames: 4, fps: 6, loop: true, bodyH: 1, anchorX: 0.5, footY: 1 },
    'char/dps/idle': { type: 'frames', dir: 'art/char/dps/idle', prefix: 'idle', frames: 15, fps: 10, loop: true, blend: 0.45, bodyH: 0.998, anchorX: 0.3898, footY: 1 },
    'char/healer/idle': { type: 'frames', dir: 'art/char/healer/idle', frames: 4, fps: 6, loop: true, bodyH: 1, anchorX: 0.5, footY: 1 },
    'ui/battle/hud/profile':      { type: 'sprite', path: 'art/ui/battle/hud/profile_cluster' },
    'ui/battle/hud/gold':         { type: 'sprite', path: 'art/ui/battle/hud/resource_gold_full' },
    'ui/battle/hud/jade':         { type: 'sprite', path: 'art/ui/battle/hud/resource_jade_full' },
    'ui/battle/hud/energy':       { type: 'sprite', path: 'art/ui/battle/hud/resource_energy_full' },
    'ui/battle/stage/chapter':    { type: 'sprite', path: 'art/ui/battle/stage/chapter_banner' },
    'ui/battle/stage/wave':       { type: 'sprite', path: 'art/ui/battle/stage/wave_progress' },
    'ui/battle/stage/reward':     { type: 'sprite', path: 'art/ui/battle/stage/reward_card' },
    'ui/battle/skills/skill_01':  { type: 'sprite', path: 'art/ui/battle/skills/skill_01' },
    'ui/battle/skills/skill_02':  { type: 'sprite', path: 'art/ui/battle/skills/skill_02' },
    'ui/battle/skills/skill_03':  { type: 'sprite', path: 'art/ui/battle/skills/skill_03' },
    'ui/battle/nav/bar':          { type: 'sprite', path: 'art/ui/battle/nav/nav_bar_full' },
    'ui/main/hud/avatar':         { type: 'sprite', path: 'art/ui/main/hud-avatar-frame' },
    'ui/main/hud/power':          { type: 'sprite', path: 'art/ui/main/hud-power-plaque' },
    'ui/main/hud/chapter-wave':   { type: 'sprite', path: 'art/ui/main/hud-chapter-wave' },
    'ui/main/hud/gold':           { type: 'sprite', path: 'art/ui/main/hud-currency-gold' },
    'ui/main/hud/gem':            { type: 'sprite', path: 'art/ui/main/hud-currency-gem' },
    'ui/main/skill/sword':        { type: 'sprite', path: 'art/ui/main/skill-sword' },
    'ui/main/skill/bow':          { type: 'sprite', path: 'art/ui/main/skill-bow' },
    'ui/main/skill/heal':         { type: 'sprite', path: 'art/ui/main/skill-heal' },
    'ui/main/panel/background':   { type: 'sprite', path: 'art/ui/main/equipment-panel-background' },
    'ui/main/panel/captain':      { type: 'sprite', path: 'art/ui/main/captain-card' },
    'ui/main/panel/equip-slot':   { type: 'sprite', path: 'art/ui/main/equipment-slot' },
    'ui/main/panel/char-switch':  { type: 'sprite', path: 'art/ui/main/character-switch-tray' },
    'ui/main/panel/stats':        { type: 'sprite', path: 'art/ui/main/stats-strip' },
    'ui/main/panel/change':       { type: 'sprite', path: 'art/ui/main/change-equipment-button' },
    'ui/main/panel/selected':     { type: 'sprite', path: 'art/ui/main/portrait-selected-ring' },
    'ui/main/icon/weapon':        { type: 'sprite', path: 'art/ui/main/icon-weapon' },
    'ui/main/icon/helmet':        { type: 'sprite', path: 'art/ui/main/icon-helmet' },
    'ui/main/icon/armor':         { type: 'sprite', path: 'art/ui/main/icon-armor' },
    'ui/main/icon/accessory':     { type: 'sprite', path: 'art/ui/main/icon-accessory' },
    'ui/main/icon/boots':         { type: 'sprite', path: 'art/ui/main/icon-boots' },
    'ui/main/nav/bar':            { type: 'sprite', path: 'art/ui/main/nav-bar' },
    'ui/main/nav/portrait':       { type: 'sprite', path: 'art/ui/main/nav-character' },
    'ui/main/nav/main':           { type: 'sprite', path: 'art/ui/main/nav-button-main-selected' },
    'ui/main/nav/squad':          { type: 'sprite', path: 'art/ui/main/nav-button-squad-normal' },
    'ui/main/nav/bag':            { type: 'sprite', path: 'art/ui/main/nav-button-bag-normal' },
    'ui/main/nav/character':      { type: 'sprite', path: 'art/ui/main/nav-button-character-normal' },
    'ui/main/nav/rune':           { type: 'sprite', path: 'art/ui/main/nav-button-rune-normal' },
    'ui/boot/background':         { type: 'sprite', path: 'art/ui/boot/background' },
    'ui/boot/loading_ring':       { type: 'sprite', path: 'art/ui/boot/loading_ring' },
    'ui/boot/loading_progress':   { type: 'sprite', path: 'art/ui/boot/loading_progress' },
    'ui/boot/bottom_fade':        { type: 'sprite', path: 'art/ui/boot/bottom_fade' },
    'ui/boot/notice':             { type: 'sprite', path: 'art/ui/boot/notice' },
    'ui/boot/title':              { type: 'sprite', path: 'art/ui/boot/title' },
    'ui/boot/start_button':       { type: 'sprite', path: 'art/ui/boot/start_button' },
    'ui/boot/age_rating':         { type: 'sprite', path: 'art/ui/boot/age_rating' },
    'char/tank/run':    { type: 'frames', dir: 'art/char/tank/run',    prefix: 'run',    frames: 18, fps: 18, loop: true,  pingpong: true, blend: 0.45, bodyH: 0.9783, anchorX: 0.5508, footY: 0.9807 },
    'char/tank/attack': { type: 'frames', dir: 'art/char/tank/attack', prefix: 'attack', frames: 18, fps: 24, loop: true,  blend: 0.35, bodyH: 0.9783, anchorX: 0.5508, footY: 0.9807 },
    'char/tank/death':  { type: 'frames', dir: 'art/char/tank/death',  prefix: 'death',  frames: 4,  fps: 8,  loop: false, blend: 0.35, bodyH: 1, anchorX: 0.5, footY: 1 },
    'char/dps/run': { type: 'frames', dir: 'art/char/dps/run', prefix: 'run', frames: 6, fps: 6, loop: true, blend: 0.45, bodyH: 0.9812, anchorX: 0.4497, footY: 1 },
    'char/dps/attack': { type: 'frames', dir: 'art/char/dps/attack', prefix: 'attack', frames: 36, fps: 24, loop: true, blend: 0.45, bodyH: 0.9451, anchorX: 0.3841, footY: 1 },
    'char/dps/death':   { type: 'frames', dir: 'art/char/dps/death',   prefix: 'death',  frames: 4,  fps: 8,  loop: false, blend: 0.35, bodyH: 0.9619, anchorX: 0.3756, footY: 0.9805 },
    'char/healer/run':    { type: 'frames', dir: 'art/char/healer/run',    prefix: 'run',    frames: 18, fps: 18, loop: true,  pingpong: true, blend: 0.45, bodyH: 0.9783, anchorX: 0.5508, footY: 0.9807 },
    'char/healer/attack': { type: 'frames', dir: 'art/char/healer/attack', prefix: 'attack', frames: 18, fps: 24, loop: true,  blend: 0.35, bodyH: 0.9783, anchorX: 0.5508, footY: 0.9807 },
    'char/healer/death':  { type: 'frames', dir: 'art/char/healer/death',  prefix: 'death',  frames: 4,  fps: 8,  loop: false, blend: 0.35, bodyH: 1, anchorX: 0.5, footY: 1 },
    'char/001/run': { type: 'frames', dir: 'art/char/001/run', prefix: 'run', frames: 18, fps: 18, loop: true, pingpong: true, blend: 0.45, bodyH: 0.9783, anchorX: 0.5508, footY: 0.9807 },
    'char/001/attack_01': { type: 'frames', dir: 'art/char/001/attack_01', prefix: 'attack_01', frames: 18, fps: 36, loop: true, blend: 0.45, bodyH: 0.9783, anchorX: 0.5508, footY: 0.9807 },
    'char/dps/attack_01': { type: 'frames', dir: 'art/char/dps/attack_01', prefix: 'attack_01', frames: 24, fps: 24, loop: true, blend: 0.45, bodyH: 0.9549, anchorX: 0.4054, footY: 1 },
};

export function entryFiles(entry: ArtEntry): string[] {
    if (entry.type === 'sprite') return [entry.path];
    const prefix = entry.prefix ?? 'idle';
    const out: string[] = [];
    for (let i = 0; i < entry.frames; i++) out.push(`${entry.dir}/${prefix}_${i}`);
    return out;
}
