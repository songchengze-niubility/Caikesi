// 装备背包占位 UI（覆盖层）：顶部 5 装备栏 + 左背包 + 右仓库 + 底部按钮。
// 色块格子（品质上色）+ Label 名字。点击命中用热区 hit-test。接美术时换 Sprite。

import { Node, Graphics, Label, UITransform, Color, Vec3, EventTouch } from 'cc';
import { InventoryModel } from './InventoryModel';
import { SLOTS, SLOT_LABEL, QUALITY_COLOR, EquipSlot, EquipItem, CharacterId, CHARACTERS, CHARACTER_LABEL } from './EquipDefs';

type Zone = 'backpack' | 'warehouse' | 'equipped';
interface Hot { x: number; y: number; w: number; h: number; kind: string; zone?: Zone; id?: string; slot?: EquipSlot; char?: CharacterId; }

const CELL = 92, GAP = 8, COLS = 4;

export class InventoryView {
    private root: Node;
    private gfx: Graphics;
    private labelPool: Label[] = [];
    private hots: Hot[] = [];
    private sel: { zone: Zone; id?: string; slot?: EquipSlot } | null = null;
    private activeChar: CharacterId = CHARACTERS[0];   // 当前选中的角色（装备栏归它）
    private toast = '';
    private toastT = 0;

    constructor(
        private parent: Node,
        private halfW: number,
        private halfH: number,
        private model: InventoryModel,
        private onChanged: () => void,
    ) {
        this.root = new Node('InventoryView');
        this.root.layer = parent.layer;
        this.root.addComponent(UITransform).setContentSize(halfW * 2, halfH * 2);
        const g = new Node('InvGfx');
        g.layer = parent.layer;
        g.addComponent(UITransform);
        this.gfx = g.addComponent(Graphics);
        this.root.addChild(g);
        parent.addChild(this.root);
        this.root.active = false;
        this.root.on(Node.EventType.TOUCH_END, this.onTap, this);
    }

    isOpen(): boolean { return this.root.active; }
    toggle(): void { this.root.active = !this.root.active; if (this.root.active) { this.sel = null; this.render(); } }
    refresh(): void { if (this.root.active) this.render(); }

    private setToast(s: string) { this.toast = s; this.toastT = 1.5; }

    // 每帧由 BattleEntry.update 调；只在打开时重画（toast 淡出）
    update(dt: number) {
        if (!this.root.active) return;
        if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) { this.toast = ''; } this.render(); }
    }

    private getLabel(i: number): Label {
        while (i >= this.labelPool.length) {
            const n = new Node('InvLbl'); n.layer = this.root.layer; n.addComponent(UITransform);
            const lb = n.addComponent(Label); lb.fontSize = 18; lb.lineHeight = 20;
            this.root.addChild(n); this.labelPool.push(lb);
        }
        return this.labelPool[i];
    }

    private render() {
        const g = this.gfx; g.clear();
        this.hots = [];
        let li = 0;
        const lbl = (x: number, y: number, s: string, size = 18, col = new Color(240, 240, 240)) => {
            const lb = this.getLabel(li++); lb.node.active = true; lb.string = s; lb.fontSize = size;
            lb.lineHeight = size + 2; lb.color = col; lb.node.setPosition(x, y, 0);
        };

        // 背板
        g.fillColor = new Color(18, 20, 26, 235);
        g.rect(-this.halfW, -this.halfH, this.halfW * 2, this.halfH * 2); g.fill();

        // —— 顶部：角色切换按钮（一行）——
        const charY = this.halfH - 56;   // 按钮区 [charY, charY+40]
        lbl(-this.halfW + 90, charY + 20, '角色', 22, new Color(255, 220, 120));
        let cx = -this.halfW + 150;
        for (const c of CHARACTERS) {
            const on = c === this.activeChar;
            g.fillColor = on ? new Color(90, 120, 160) : new Color(55, 60, 72);
            g.roundRect(cx, charY, 96, 40, 6); g.fill();
            if (on) { g.strokeColor = new Color(255, 230, 120); g.lineWidth = 3; g.roundRect(cx, charY, 96, 40, 6); g.stroke(); }
            lbl(cx + 48, charY + 20, CHARACTER_LABEL[c], 18);
            this.hots.push({ x: cx, y: charY, w: 96, h: 40, kind: 'char', char: c });
            cx += 104;
        }

        // —— 当前角色的 5 装备栏（在角色行下方）——
        lbl(0, this.halfH - 86, `${CHARACTER_LABEL[this.activeChar]} 的装备栏`, 20, new Color(220, 220, 235));
        const topY = this.halfH - 100 - CELL;   // 装备格区 [topY, topY+CELL]，整体在标题/角色行之下
        const eq = this.model.equipped[this.activeChar];
        const ew = SLOTS.length * (CELL + GAP) - GAP;
        let ex = -ew / 2;
        for (const slot of SLOTS) {
            const it = eq[slot];
            this.drawCell(g, ex, topY, it, this.sel?.zone === 'equipped' && this.sel.slot === slot);
            lbl(ex + CELL / 2, topY + CELL + 2, SLOT_LABEL[slot], 14, new Color(170, 170, 180));
            if (it) lbl(ex + CELL / 2, topY + CELL / 2, it.name, 16);
            this.hots.push({ x: ex, y: topY, w: CELL, h: CELL, kind: 'cell', zone: 'equipped', slot });
            ex += CELL + GAP;
        }

        // —— 中部：左背包 / 右仓库 ——
        const midTop = topY - 60;
        this.drawGrid(g, lbl, 'backpack', -this.halfW + 30, midTop, `背包 ${this.model.backpack.length}/${this.model.maxBackpack}`, this.model.backpack);
        this.drawGrid(g, lbl, 'warehouse', 30, midTop, `仓库 ${this.model.warehouse.length}/${this.model.maxWarehouse}`, this.model.warehouse);

        // —— 底部按钮 ——
        const by = -this.halfH + 50;
        const btn = (x: number, s: string, kind: string) => {
            g.fillColor = new Color(60, 66, 80); g.roundRect(x, by, 110, 44, 8); g.fill();
            lbl(x + 55, by + 22, s, 18);
            this.hots.push({ x, y: by, w: 110, h: 44, kind });
        };
        btn(-this.halfW + 20, '掉落', 'drop');
        btn(-this.halfW + 140, '转移', 'transfer');
        btn(-this.halfW + 260, '穿', 'equip');
        btn(-this.halfW + 380, '脱', 'unequip');
        btn(this.halfW - 130, '关闭', 'close');

        if (this.toast) lbl(0, by + 70, this.toast, 20, new Color(255, 120, 120));

        // 隐藏多余 label
        for (let i = li; i < this.labelPool.length; i++) this.labelPool[i].node.active = false;
    }

    private drawGrid(g: Graphics, lbl: (x: number, y: number, s: string, size?: number, c?: Color) => void,
                     zone: Zone, x0: number, yTop: number, title: string, list: EquipItem[]) {
        lbl(x0 + 200, yTop + 26, title, 20, new Color(200, 210, 230));
        for (let i = 0; i < list.length; i++) {
            const r = Math.floor(i / COLS), c = i % COLS;
            const x = x0 + c * (CELL + GAP), y = yTop - 10 - (r + 1) * (CELL + GAP);
            const it = list[i];
            this.drawCell(g, x, y, it, this.sel?.zone === zone && this.sel.id === it.id);
            lbl(x + CELL / 2, y + CELL / 2, it.name, 16);
            this.hots.push({ x, y, w: CELL, h: CELL, kind: 'cell', zone, id: it.id });
        }
    }

    private drawCell(g: Graphics, x: number, y: number, it: EquipItem | null, selected: boolean) {
        if (it) { const c = QUALITY_COLOR[it.quality]; g.fillColor = new Color(c[0], c[1], c[2], 220); }
        else g.fillColor = new Color(50, 54, 64, 200);
        g.roundRect(x, y, CELL, CELL, 6); g.fill();
        g.strokeColor = selected ? new Color(255, 230, 120) : new Color(90, 96, 110);
        g.lineWidth = selected ? 4 : 2; g.roundRect(x, y, CELL, CELL, 6); g.stroke();
    }

    private onTap(e: EventTouch) {
        // 屏幕坐标 → root 本地坐标
        const ui = e.getUILocation();
        const p = this.root.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        const hit = this.hots.find(h => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h);
        if (!hit) return;
        if (hit.kind === 'char') {
            this.activeChar = hit.char!;
            this.sel = null;        // 切角色清掉选中（装备栏选中归属变了）
            this.render(); return;
        }
        if (hit.kind === 'cell') {
            this.sel = { zone: hit.zone!, id: hit.id, slot: hit.slot };
            this.render(); return;
        }
        this.handleButton(hit.kind);
    }

    private handleButton(kind: string) {
        const m = this.model;
        let r = { ok: true, reason: '' } as { ok: boolean; reason?: string };
        switch (kind) {
            case 'close': this.toggle(); return;
            case 'drop': r = m.dropRandom(); break;
            case 'transfer':
                if (!this.sel || !this.sel.id) { this.setToast('先选背包或仓库里的装备'); this.render(); return; }
                r = this.sel.zone === 'backpack' ? m.toWarehouse(this.sel.id) : m.toBackpack(this.sel.id);
                break;
            case 'equip':
                if (!this.sel || this.sel.zone !== 'backpack' || !this.sel.id) { this.setToast('先在背包选要穿的装备'); this.render(); return; }
                r = m.equip(this.sel.id, this.activeChar); break;
            case 'unequip':
                if (!this.sel || this.sel.zone !== 'equipped' || !this.sel.slot) { this.setToast('先选装备栏里的装备'); this.render(); return; }
                r = m.unequip(this.activeChar, this.sel.slot); break;
        }
        if (!r.ok) { this.setToast(r.reason || '操作失败'); }
        else { this.sel = null; this.onChanged(); }
        this.render();
    }
}
