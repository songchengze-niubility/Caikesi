// 角色天赋树配置纯查询层（不依赖 cc）。与账号级心法（talent/）无关。
// ★★★ 数值由 Excel 管理 ★★★ 源文件：tools/config-xlsx/chartalent.xlsx → npm run config

import { generatedCharTalentConfig } from '../config/chartalent.config.generated';
import type { PassiveDef } from '../config/SkillConfig';

export type CharTalentKind = 'stat' | 'passive';

export interface CharTalentNodeDef {
    id: string;
    label: string;
    cls: string;           // SoldierClass；导表已校验合法性
    tier: number;          // 等级门槛分层的行号（UI 排布用）
    levelReq: number;      // 角色等级门槛（唯一前置条件，无节点连线）
    maxLevel: number;      // 全部可多级，每级 1 技能点
    kind: CharTalentKind;
    statKey: string;       // kind=stat 时为 EquipStatKey；passive 为空
    valuePerLevel: number; // kind=stat 每级加值；passive 为 0
}

export interface CharTalentPassiveRow { nodeId: string; level: number; def: PassiveDef; }
export interface CharTalentConfigShape { nodes: CharTalentNodeDef[]; passives: CharTalentPassiveRow[]; }

export const CharTalentConfig = generatedCharTalentConfig as CharTalentConfigShape;

let _byId: Map<string, CharTalentNodeDef> | null = null;
let _byCls: Map<string, CharTalentNodeDef[]> | null = null;
let _passiveByKey: Map<string, PassiveDef> | null = null;

export function charTalentNodes(cls: string): CharTalentNodeDef[] {
    if (!_byCls) {
        _byCls = new Map();
        for (const n of CharTalentConfig.nodes) {
            const list = _byCls.get(n.cls) ?? [];
            list.push(n);
            _byCls.set(n.cls, list);
        }
    }
    return _byCls.get(cls) ?? [];
}

export function charTalentNodeById(id: string): CharTalentNodeDef | undefined {
    if (!_byId) {
        _byId = new Map();
        for (const n of CharTalentConfig.nodes) _byId.set(n.id, n);
    }
    return _byId.get(id);
}

// 被动节点第 level 级的 PassiveDef；stat 节点/越级返回 undefined
export function charTalentPassiveAt(nodeId: string, level: number): PassiveDef | undefined {
    if (!_passiveByKey) {
        _passiveByKey = new Map();
        for (const p of CharTalentConfig.passives) _passiveByKey.set(`${p.nodeId}|${p.level}`, p.def);
    }
    return _passiveByKey.get(`${nodeId}|${level}`);
}

// 整树点满所需技能点（= 全节点 maxLevel 之和；UI 展示与测试用）
export function charTalentTreeCapacity(cls: string): number {
    let sum = 0;
    for (const n of charTalentNodes(cls)) sum += n.maxLevel;
    return sum;
}
