// 游戏管理器（GameManager）—— 框架核心，全局唯一（单例）
// 负责：持有玩家数据、每秒挂机产出、计算离线收益、定时存档。
// 它是纯逻辑，不依赖场景/界面，所以很好测试、很好复用。

import { GameConfig } from '../config/GameConfig';
import { DataService, PlayerData } from './data/DataService';
import { EventCenter, Events } from './event/EventCenter';

export class GameManager {
    private static _inst: GameManager;
    static get instance(): GameManager {
        if (!this._inst) this._inst = new GameManager();
        return this._inst;
    }

    data: PlayerData = null!;       // 玩家存档
    private _accum = 0;             // 累计时间，满 1 秒产出一次金币
    private _saveAccum = 0;         // 累计时间，满 5 秒存一次档

    // 游戏启动：读存档 + 结算离线收益。返回离线赚到的金币（界面用来弹提示）。
    async start(): Promise<number> {
        this.data = await DataService.load();
        if (this.data.power <= 0) this.data.power = GameConfig.basePower;

        const offlineGold = this._settleOffline();
        this.data.gold += offlineGold;
        this.data.lastSaveTime = Date.now();
        await this.save();

        // 通知界面刷新初始数值
        EventCenter.emit(Events.GOLD_CHANGED, this.data.gold);
        EventCenter.emit(Events.POWER_CHANGED, this.data.power);
        return offlineGold;
    }

    // 计算离线期间赚的金币
    private _settleOffline(): number {
        const now = Date.now();
        let seconds = (now - this.data.lastSaveTime) / 1000;
        if (seconds < 0) seconds = 0; // 防止玩家把手机时间往回调
        const maxSeconds = GameConfig.offlineMaxHours * 3600;
        if (seconds > maxSeconds) seconds = maxSeconds;
        return Math.floor(seconds * GameConfig.goldPerSecond * GameConfig.offlineEfficiency);
    }

    // 每帧调用一次（由 GameEntry 的 update 驱动），dt 是这一帧经过的秒数
    tick(dt: number) {
        if (!this.data) return;

        // 在线挂机产出：每满 1 秒加一次金币
        this._accum += dt;
        while (this._accum >= 1) {
            this._accum -= 1;
            this.data.gold += GameConfig.goldPerSecond;
            EventCenter.emit(Events.GOLD_CHANGED, this.data.gold);
        }

        // 每 5 秒自动存一次档
        this._saveAccum += dt;
        if (this._saveAccum >= 5) {
            this._saveAccum = 0;
            this.save();
        }
    }

    async save() {
        if (!this.data) return;
        this.data.lastSaveTime = Date.now();
        await DataService.save(this.data);
    }
}
