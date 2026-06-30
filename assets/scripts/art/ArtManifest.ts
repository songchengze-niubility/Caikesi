// Art manifest: logical keys -> resources under assets/resources.
// Paths are relative to resources/ and do not include file extensions.
export type ArtEntry =
    | { type: 'sprite'; path: string }
    | { type: 'frames'; dir: string; prefix?: string; frames: number; fps: number; loop: boolean; pingpong?: boolean; blend?: number };

export const ArtManifest: Record<string, ArtEntry> = {
    'bg/main':          { type: 'sprite', path: 'art/bg/main' },
    'char/tank/idle':   { type: 'frames', dir: 'art/char/tank/idle',   frames: 4, fps: 6, loop: true },
    'char/dps/idle':    { type: 'frames', dir: 'art/char/dps/idle',    prefix: 'idle', frames: 16, fps: 10, loop: true, pingpong: true, blend: 0.45 },
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

export function entryFiles(entry: ArtEntry): string[] {
    if (entry.type === 'sprite') return [entry.path];
    const prefix = entry.prefix ?? 'idle';
    const out: string[] = [];
    for (let i = 0; i < entry.frames; i++) out.push(`${entry.dir}/${prefix}_${i}`);
    return out;
}
