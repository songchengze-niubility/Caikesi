// 技能配置。
// ★★★ 数值由 Excel 管理 ★★★
//    源文件：tools/config-xlsx/skill.xlsx
//    改数值流程：编辑 Excel → 跑 `npm run config` → 生成 skill.config.generated.ts
//    本文件只保留 TypeScript 类型定义与查询辅助。

import { generatedSkillConfig } from './skill.config.generated';
import type { Effect, DeliveryDef } from './EffectTypes';

export type SkillTrigger = 'timer' | 'attackCount';
export type SkillTarget = 'aoe' | 'nearest' | 'single';

export interface SkillDef {
    id: string;
    name: string;
    cls: string;              // 归属职业（tank/dps/healer）
    trigger: SkillTrigger;
    triggerValue: number;     // 秒数（timer）或普攻次数（attackCount）
    target: SkillTarget;
    radius: number;           // aoe 用
    maxTargets: number;       // nearest 用
    effects: Effect[];        // 效果列表（伤害只是其中一种），xlsx 编码见 EffectTypes.ts
    delivery: DeliveryDef | null;   // 投递方式：null=instant；line/arc 发弹道、zone 落场地
}

// —— 被动技能（2 槽制：每职业主动+被动合计 ≤ 2 行，导表校验）——
export type PassiveTrigger = 'always' | 'onHit' | 'onHurt' | 'onKill' | 'onCast';
export type PassiveTargetMode = 'trigger' | 'self' | 'team';

export interface PassiveDef {
    id: string;
    name: string;
    cls: string;
    trigger: PassiveTrigger;      // always=开战常驻/光环；其余为条件触发钩子
    chance: number;               // 触发概率 0~1（always 必为 1）
    targetMode: PassiveTargetMode;// trigger=事件对象 / self=自己 / team=全队存活者
    effects: Effect[];
}

export interface SkillConfigShape {
    skills: SkillDef[];
    passives: PassiveDef[];
}

export const SkillConfig = generatedSkillConfig as SkillConfigShape;

// 某职业的技能列表（保持配置行顺序 = UI 按钮顺序）
export function skillsForClass(cls: string): SkillDef[] {
    return SkillConfig.skills.filter(s => s.cls === cls);
}

// 某职业的被动列表
export function passivesForClass(cls: string): PassiveDef[] {
    return SkillConfig.passives.filter(p => p.cls === cls);
}
