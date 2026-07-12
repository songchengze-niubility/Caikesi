// 养成数值框架真源配置（balance.xlsx → balance.config.generated.ts）。
// ★ 游戏运行时不消费本配置——它是 tools/balance-model 求解器的输入（份额/锚点/上限/例外）。
//   放在 config/ 目录是沿用"xlsx → generated → 类型包装"的统一管线；改旋钮：编辑
//   tools/config-xlsx/balance.xlsx（或 seed-balance-xlsx.ts 重建）→ npm run config。

import { generatedBalanceConfig } from './balance.config.generated';

export type BalanceModule = 'base' | 'level' | 'equip' | 'gem' | 'inscription' | 'skill';

export interface BalanceOverride {
    target: string;   // 派生键，形如 "equip.slotBonusScale"
    value: number;
    reason: string;
}

export interface BalanceConfigShape {
    shares: Record<BalanceModule, number>;   // 合计 = 1（导表校验）
    anchors: Record<string, number>;         // 体验锚点/毕业快照参数
    caps: Record<string, number>;            // 二级属性上限（derive 校验毕业快照不越限）
    overrides: BalanceOverride[];
}

export const BalanceConfig = generatedBalanceConfig as BalanceConfigShape;
