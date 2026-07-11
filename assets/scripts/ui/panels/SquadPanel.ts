import { Color, EventTouch, Graphics, Label, Node, UITransform, Vec3 } from 'cc';
import { BattleConfig, SoldierClass } from '../../config/BattleConfig';
import { CHARACTER_LABEL } from '../../inventory/EquipDefs';
import type { CharacterGrowthModel } from '../../growth/CharacterGrowthModel';
import type { SquadModel } from '../../squad/SquadModel';

interface SquadHot {
    rect: { x: number; y: number; w: number; h: number };
    act: () => void;
}

export interface SquadPanelOptions {
    host: Node;
    halfW: number;
    halfH: number;
    getSquad: () => SquadModel | null;
    getGrowth: () => CharacterGrowthModel | null;
    beforeShow: () => void;
    onChanged: () => void;
}

export class SquadPanel {
    private readonly root: Node;
    private readonly gfx: Graphics;
    private readonly labels: Label[] = [];
    private readonly hots: SquadHot[] = [];

    constructor(private readonly options: SquadPanelOptions) {
        this.root = new Node('SquadView');
        this.root.layer = options.host.layer;
        this.root.addComponent(UITransform).setContentSize(options.halfW * 2, options.halfH * 2);

        const gfxNode = new Node('SquadGfx');
        gfxNode.layer = this.root.layer;
        gfxNode.addComponent(UITransform);
        this.gfx = gfxNode.addComponent(Graphics);
        this.root.addChild(gfxNode);
        options.host.addChild(this.root);
        this.root.active = false;
        this.root.on(Node.EventType.TOUCH_END, this.onTap, this);
    }

    isOpen(): boolean {
        return this.root.active;
    }

    toggle(): void {
        if (this.isOpen()) this.hide();
        else this.show();
    }

    show(): void {
        if (!this.options.getSquad()) return;
        this.options.beforeShow();
        this.root.active = true;
        this.root.setSiblingIndex(this.options.host.children.length - 1);
        this.render();
    }

    hide(): void {
        this.root.active = false;
    }

    refresh(): void {
        if (this.isOpen()) this.render();
    }

    destroy(): void {
        this.root.off(Node.EventType.TOUCH_END, this.onTap, this);
    }

    private labelAt(i: number): Label {
        while (i >= this.labels.length) {
            const node = new Node('SquadLbl');
            node.layer = this.root.layer;
            node.addComponent(UITransform);
            const label = node.addComponent(Label);
            this.root.addChild(node);
            this.labels.push(label);
        }
        return this.labels[i];
    }

    private render(): void {
        const squad = this.options.getSquad();
        if (!squad) return;

        const g = this.gfx;
        g.clear();
        this.hots.length = 0;
        for (const label of this.labels) label.node.active = false;
        let li = 0;
        const label = (text: string, x: number, y: number, size = 24) => {
            const item = this.labelAt(li++);
            item.node.active = true;
            item.string = text;
            item.fontSize = size;
            item.node.setPosition(x, y, 0);
        };

        g.fillColor = new Color(20, 24, 30, 230);
        g.rect(-this.options.halfW, -this.options.halfH, this.options.halfW * 2, this.options.halfH * 2);
        g.fill();

        const deployed = squad.deployedList();
        label(`出战阵容  ${deployed.length}/${squad.squadCap}（点板凳上阵 / 点出战下阵 / ↑调前后）`, 0, 560, 26);

        const rowH = 96;
        const x0 = -300;
        const rowW = 600;
        const pushRow = (name: string, y: number, tag: string, onRow: () => void, upBtn?: () => void) => {
            g.fillColor = new Color(48, 58, 72, 255);
            g.roundRect(x0, y - rowH / 2, rowW, rowH - 12, 10);
            g.fill();
            label(`${tag}  ${name}`, x0 + 20, y, 24);
            this.hots.push({ rect: { x: x0, y: y - rowH / 2, w: rowW - 96, h: rowH - 12 }, act: onRow });
            if (upBtn) {
                g.fillColor = new Color(80, 120, 160, 255);
                g.roundRect(x0 + rowW - 84, y - rowH / 2, 72, rowH - 12, 10);
                g.fill();
                label('↑', x0 + rowW - 56, y, 30);
                this.hots.push({ rect: { x: x0 + rowW - 84, y: y - rowH / 2, w: 72, h: rowH - 12 }, act: upBtn });
            }
        };

        const nameWithLevel = (cls: SoldierClass): string => {
            const level = this.options.getGrowth()?.levelOf(cls) ?? 1;
            const maxLevel = BattleConfig.charGrowth?.maxLevel ?? 30;
            return `${CHARACTER_LABEL[cls]}  Lv.${level}${level >= maxLevel ? '·满' : ''}`;
        };

        let y = 420;
        deployed.forEach((cls, index) => {
            pushRow(
                nameWithLevel(cls),
                y,
                `出战${index + 1}`,
                () => this.undeploy(cls),
                index > 0 ? () => this.move(cls, index - 1) : undefined,
            );
            y -= rowH;
        });
        y -= 24;
        for (const cls of squad.benchList()) {
            pushRow(nameWithLevel(cls), y, '板凳', () => this.deploy(cls));
            y -= rowH;
        }

        g.fillColor = new Color(120, 60, 60, 255);
        g.roundRect(-90, -560, 180, 70, 12);
        g.fill();
        label('关闭', 0, -525, 26);
        this.hots.push({ rect: { x: -90, y: -560, w: 180, h: 70 }, act: () => this.hide() });
    }

    private deploy(cls: SoldierClass): void {
        if (this.options.getSquad()?.deploy(cls)) this.afterChange();
    }

    private undeploy(cls: SoldierClass): void {
        if (this.options.getSquad()?.undeploy(cls)) this.afterChange();
    }

    private move(cls: SoldierClass, toIndex: number): void {
        if (this.options.getSquad()?.move(cls, toIndex)) this.afterChange();
    }

    private afterChange(): void {
        this.render();
        this.options.onChanged();
    }

    private onTap(e: EventTouch): void {
        const ui = e.getUILocation();
        const p = this.root.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        for (const hot of this.hots) {
            const rect = hot.rect;
            if (p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h) {
                hot.act();
                return;
            }
        }
    }
}
