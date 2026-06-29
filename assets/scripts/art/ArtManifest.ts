// 美术对照表：逻辑键 → 资源描述。这是「需要哪些美术、放哪」的唯一权威。
// 纯数据，不依赖 cc。Codex 加美术时在 ArtManifest 里登记一行。
// 路径相对 assets/resources/，不含扩展名（Cocos resources.load 约定）。

export type ArtEntry =
    | { type: 'sprite'; path: string }                                              // 单张静态图
    | { type: 'frames'; dir: string; frames: number; fps: number; loop: boolean };  // 序列帧（dir/idle_0.png…）

export const ArtManifest: Record<string, ArtEntry> = {
    'bg/main':          { type: 'sprite', path: 'art/bg/main' },
    'char/tank/idle':   { type: 'frames', dir: 'art/char/tank/idle',   frames: 4, fps: 6, loop: true },
    'char/dps/idle':    { type: 'frames', dir: 'art/char/dps/idle',    frames: 4, fps: 6, loop: true },
    'char/healer/idle': { type: 'frames', dir: 'art/char/healer/idle', frames: 4, fps: 6, loop: true },
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
};

// 该条目涉及的全部资源路径（相对 resources/，不含扩展名）。check-art 和 ArtRegistry 共用。
export function entryFiles(entry: ArtEntry): string[] {
    if (entry.type === 'sprite') return [entry.path];
    const out: string[] = [];
    for (let i = 0; i < entry.frames; i++) out.push(`${entry.dir}/idle_${i}`);
    return out;
}
