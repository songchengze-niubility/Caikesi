// 动作编辑器导出 JSON → 回写 parts.actions.generated.ts。
// 用法：npm run rig:import [json路径]；缺省时自动找 Downloads 里最新的 parts-rig-actions*.json
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RIG_ACTION_IDS, RIG_PART_IDS } from '../assets/scripts/art/PartsRigConfig';

function findDefault(): string {
    const dl = path.join(os.homedir(), 'Downloads');
    const candidates = fs.readdirSync(dl)
        .filter((f) => /^parts-rig-actions.*\.json$/.test(f))
        .map((f) => path.join(dl, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (!candidates.length) throw new Error('Downloads 里没有 parts-rig-actions*.json，请从编辑器导出或显式传路径');
    return candidates[0];
}

const src = process.argv[2] || findDefault();
const data = JSON.parse(fs.readFileSync(src, 'utf8'));

// 校验：动作/部件 id、轨道形状、时刻范围
const partSet = new Set<string>([...RIG_PART_IDS]);
for (const action of RIG_ACTION_IDS) {
    const def = data[action];
    if (!def) throw new Error(`缺动作 ${action}`);
    if (!(def.duration > 0)) throw new Error(`${action}.duration 非法`);
    type TrackMap = Record<string, { times: number[]; values: number[] }>;
    const partEntries = Object.entries(def.parts || {}) as [string, TrackMap][];
    const rootEntries: [string, TrackMap][] = def.root ? [['root', def.root as TrackMap]] : [];
    const animSets: [string, TrackMap][] = [...partEntries, ...rootEntries];
    for (const [pid, anim] of animSets) {
        if (pid !== 'root' && !partSet.has(pid)) throw new Error(`${action} 有未知部件 ${pid}`);
        for (const [ch, tr] of Object.entries(anim || {})) {
            if (!tr || !Array.isArray(tr.times)) throw new Error(`${action}.${pid}.${ch} 轨道非法`);
            if (tr.times.length !== tr.values.length) throw new Error(`${action}.${pid}.${ch} times/values 长度不一致`);
            for (let i = 0; i < tr.times.length; i++) {
                if (tr.times[i] < 0 || tr.times[i] > 1) throw new Error(`${action}.${pid}.${ch} 时刻越界`);
                if (i > 0 && tr.times[i] <= tr.times[i - 1]) throw new Error(`${action}.${pid}.${ch} 时刻未递增`);
            }
        }
    }
}

const body = JSON.stringify(data, null, 4).replace(/"([a-zA-Z]\w*)":/g, '$1:');
const header = `// 动作参数产物（勿手改）：真源=PartsRig 动作编辑器（npm run rig:editor 生成页面，导出 JSON 后 npm run rig:import 回写）
// 标准骨架全角色共享；个别角色差异化时再扩 per-character 覆盖
import type { RigActionDef, RigActionId } from './PartsRigConfig';

export const PartsRigActions: Record<RigActionId, RigActionDef> = `;
fs.writeFileSync(path.resolve(__dirname, '..', 'assets', 'scripts', 'art', 'parts.actions.generated.ts'), header + body + ';\n', 'utf8');
console.log(`[rig:import] 已回写 parts.actions.generated.ts ← ${src}`);
console.log('[rig:import] 建议随后跑：npm run test:partsrig && npx tsx tools/parts-rig-preview.ts');
