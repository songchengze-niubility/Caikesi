// 事件总线（EventCenter）
// 作用：各模块之间不直接互相调用，而是通过"发事件 / 收事件"通信，达到解耦。
// 比如：金币变了就 emit 一个事件，界面收到后自己刷新显示。
// 这是框架层，写一次基本不用动。

type Handler = (...args: any[]) => void;

interface Sub {
    cb: Handler;
    target?: any;
}

export class EventCenter {
    private static _map: Map<string, Sub[]> = new Map();

    // 监听某个事件
    static on(event: string, cb: Handler, target?: any) {
        if (!this._map.has(event)) this._map.set(event, []);
        this._map.get(event)!.push({ cb, target });
    }

    // 取消监听
    static off(event: string, cb: Handler, target?: any) {
        const arr = this._map.get(event);
        if (!arr) return;
        for (let i = arr.length - 1; i >= 0; i--) {
            if (arr[i].cb === cb && arr[i].target === target) arr.splice(i, 1);
        }
    }

    // 发出某个事件，可带参数
    static emit(event: string, ...args: any[]) {
        const arr = this._map.get(event);
        if (!arr) return;
        for (const s of [...arr]) s.cb.apply(s.target, args);
    }
}

// 所有事件名集中在这里定义，避免拼错字符串
export const Events = {
    GOLD_CHANGED: 'gold_changed',   // 金币变化
    POWER_CHANGED: 'power_changed', // 战力变化
};
