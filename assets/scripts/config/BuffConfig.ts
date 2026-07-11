// Buff 配置。
// ★★★ 数值由 Excel 管理 ★★★
//    源文件：tools/config-xlsx/buff.xlsx
//    改数值流程：编辑 Excel → 跑 `npm run config` → 生成 buff.config.generated.ts
//    本文件只保留 TypeScript 类型定义与查询辅助。

import { generatedBuffConfig } from './buff.config.generated';
import type { Effect, StatMod } from './EffectTypes';

export type BuffStackRule = 'refresh' | 'add';
export type BuffFlag = 'stun' | 'taunt' | 'silence';

export interface BuffDef {
    id: string;
    name: string;
    duration: number;
    maxStacks: number;
    stackRule: BuffStackRule;
    period: number;                  // 0 = 无周期效果
    periodicEffect: Effect | null;   // period>0 时必填（导表校验）
    statMods: StatMod[];             // 每层生效，层数线性叠加
    flags: BuffFlag[];               // stun 禁动禁攻；taunt/silence 第 2 段接
    dispelTag: string;               // '' = 不可驱散
}

export interface BuffConfigShape { buffs: BuffDef[]; }
export const BuffConfig = generatedBuffConfig as BuffConfigShape;

const byId = new Map(BuffConfig.buffs.map(b => [b.id, b] as const));
export function getBuffDef(id: string): BuffDef | undefined { return byId.get(id); }
