import type { EquipItem } from '../inventory/EquipDefs';

// 表现层通用的装备奖励条目；target 只用于告诉玩家奖励最终进入背包还是仓库。
export interface RewardEntry {
    item: EquipItem;
    target: string;
}
