// Art manifest: logical keys -> resources under assets/resources.
// Paths are relative to resources/ and do not include file extensions.
export type ArtEntry =
    | { type: 'sprite'; path: string }
    | { type: 'frames'; dir: string; prefix?: string; frames: number; fps: number; loop: boolean; pingpong?: boolean; blend?: number };

export const ArtManifest: Record<string, ArtEntry> = {
    'bg/main':          { type: 'sprite', path: 'art/bg/main' },
    'char/tank/idle':   { type: 'frames', dir: 'art/char/tank/idle',   frames: 4, fps: 6, loop: true },
    'char/dps/idle': { type: 'frames', dir: 'art/char/dps/idle', prefix: 'idle', frames: 18, fps: 18, loop: false, blend: 0.45 },
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
    'ui/boot/background':         { type: 'sprite', path: 'art/ui/boot/background' },
    'ui/boot/loading_ring':       { type: 'sprite', path: 'art/ui/boot/loading_ring' },
    'ui/boot/loading_progress':   { type: 'sprite', path: 'art/ui/boot/loading_progress' },
    'ui/boot/bottom_fade':        { type: 'sprite', path: 'art/ui/boot/bottom_fade' },
    'ui/boot/notice':             { type: 'sprite', path: 'art/ui/boot/notice' },
    'ui/boot/title':              { type: 'sprite', path: 'art/ui/boot/title' },
    'ui/boot/start_button':       { type: 'sprite', path: 'art/ui/boot/start_button' },
    'ui/boot/age_rating':         { type: 'sprite', path: 'art/ui/boot/age_rating' },
    'char/tank/run':    { type: 'frames', dir: 'art/char/tank/run',    prefix: 'run',    frames: 18, fps: 18, loop: true,  pingpong: true, blend: 0.45 },
    'char/tank/attack': { type: 'frames', dir: 'art/char/tank/attack', prefix: 'attack', frames: 18, fps: 24, loop: true,  blend: 0.35 },
    'char/tank/death':  { type: 'frames', dir: 'art/char/tank/death',  prefix: 'death',  frames: 4,  fps: 8,  loop: false, blend: 0.35 },
    'char/dps/run':     { type: 'frames', dir: 'art/char/dps/run',     prefix: 'run',    frames: 18, fps: 18, loop: true,  pingpong: true, blend: 0.45 },
    'char/dps/attack':  { type: 'frames', dir: 'art/char/dps/attack',  prefix: 'attack', frames: 18, fps: 24, loop: true,  blend: 0.35 },
    'char/dps/death':   { type: 'frames', dir: 'art/char/dps/death',   prefix: 'death',  frames: 4,  fps: 8,  loop: false, blend: 0.35 },
    'char/healer/run':    { type: 'frames', dir: 'art/char/healer/run',    prefix: 'run',    frames: 18, fps: 18, loop: true,  pingpong: true, blend: 0.45 },
    'char/healer/attack': { type: 'frames', dir: 'art/char/healer/attack', prefix: 'attack', frames: 18, fps: 24, loop: true,  blend: 0.35 },
    'char/healer/death':  { type: 'frames', dir: 'art/char/healer/death',  prefix: 'death',  frames: 4,  fps: 8,  loop: false, blend: 0.35 },
    'char/001/run': { type: 'frames', dir: 'art/char/001/run', prefix: 'run', frames: 18, fps: 18, loop: true, pingpong: true, blend: 0.45 },
    'char/001/attack_01': { type: 'frames', dir: 'art/char/001/attack_01', prefix: 'attack_01', frames: 18, fps: 36, loop: true, blend: 0.45 },
};

export function entryFiles(entry: ArtEntry): string[] {
    if (entry.type === 'sprite') return [entry.path];
    const prefix = entry.prefix ?? 'idle';
    const out: string[] = [];
    for (let i = 0; i < entry.frames; i++) out.push(`${entry.dir}/${prefix}_${i}`);
    return out;
}
