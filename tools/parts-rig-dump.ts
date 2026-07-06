// 把 generated ts 的动作 + 父子链导出成 actions.json，供 export_dragonbones.py 消费。
// 用法：npm run rig:dump —— TS 侧是唯一动作真源，防手维护 JSON 漂移。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RIG_PARENTS } from '../assets/scripts/art/PartsRigConfig';
import { PartsRigActions } from '../assets/scripts/art/parts.actions.generated';

const out = path.resolve(__dirname, '..', 'temp', 'partsrig-demo', 'actions.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ actions: PartsRigActions, parents: RIG_PARENTS }, null, 2), 'utf8');
console.log(`[rig:dump] 已写出 ${out}`);
