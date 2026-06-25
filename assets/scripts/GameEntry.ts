// 游戏入口（GameEntry）—— 唯一需要你在编辑器里挂到节点上的脚本
// 作用：游戏一开始，初始化框架、用代码生成最简界面（几行文字）、驱动挂机循环。
// 第一版界面是纯代码生成的，所以你在编辑器里几乎不用摆东西。

import { _decorator, Component, Node, Label, Color, UITransform, game, Game } from 'cc';
import { GameManager } from './core/GameManager';
import { EventCenter, Events } from './core/event/EventCenter';

const { ccclass } = _decorator;

@ccclass('GameEntry')
export class GameEntry extends Component {
    private _goldLabel: Label = null!;
    private _powerLabel: Label = null!;
    private _tipLabel: Label = null!;

    async onLoad() {
        // 用代码创建三行文字
        this._goldLabel = this._makeLabel('金币: 0', 0, 120, 44);
        this._powerLabel = this._makeLabel('战力: 0', 0, 50, 44);
        this._tipLabel = this._makeLabel('框架启动中…', 0, -80, 28);
        this._tipLabel.color = new Color(140, 140, 140);

        // 监听数值变化，自动刷新文字
        EventCenter.on(Events.GOLD_CHANGED, this._onGold, this);
        EventCenter.on(Events.POWER_CHANGED, this._onPower, this);

        // 启动游戏：读档 + 结算离线收益
        const offlineGold = await GameManager.instance.start();
        if (offlineGold > 0) {
            this._tipLabel.string = `离线收益：+${offlineGold} 金币`;
        } else {
            this._tipLabel.string = '挂机中…金币每秒增长';
        }

        // 切到后台 / 退出时存档（微信小游戏切出去也会触发）
        game.on(Game.EVENT_HIDE, () => GameManager.instance.save(), this);
    }

    update(dt: number) {
        GameManager.instance.tick(dt);
    }

    private _onGold(v: number) {
        if (this._goldLabel) this._goldLabel.string = `金币: ${v}`;
    }

    private _onPower(v: number) {
        if (this._powerLabel) this._powerLabel.string = `战力: ${v}`;
    }

    // 用代码生成一行文字
    private _makeLabel(text: string, x: number, y: number, size: number): Label {
        const node = new Node('Label');
        node.layer = this.node.layer; // 继承 UI 层，保证能被 UI 相机渲染出来
        node.addComponent(UITransform);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = size;
        label.lineHeight = size + 6;
        this.node.addChild(node);
        node.setPosition(x, y, 0);
        return label;
    }

    onDestroy() {
        EventCenter.off(Events.GOLD_CHANGED, this._onGold, this);
        EventCenter.off(Events.POWER_CHANGED, this._onPower, this);
    }
}
