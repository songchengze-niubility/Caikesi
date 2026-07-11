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

export interface SkillConfigShape {
    skills: SkillDef[];
}

export const SkillConfig = generatedSkillConfig as SkillConfigShape;

// 某职业的技能列表（保持配置行顺序 = UI 按钮顺序）
export function skillsForClass(cls: string): SkillDef[] {
    return SkillConfig.skills.filter(s => s.cls === cls);
}
