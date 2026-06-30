// 装备背包占位 UI（覆盖层）：顶部 5 装备栏 + 左背包 + 右仓库 + 底部按钮。
// 色块格子（品质上色）+ Label 名字。点击命中用热区 hit-test。接美术时换 Sprite。

import { Node, Graphics, Label, UITransform, Color, Vec3, EventTouch } from 'cc';
import { InventoryModel } from './InventoryModel';
import type { OpResult } from './InventoryModel';
import {
    SLOTS, SLOT_LABEL, QUALITY_COLOR, QUALITY_LABEL, EquipSlot, EquipItem, CharacterId, CHARACTERS,
    CHARACTER_LABEL, formatEquipStats, formatStatValue, formatSignedStatValue, STAT_LABEL, STAT_ORDER,
    EquipStats,
} from './EquipDefs';

type Zone = 'backpack' | 'warehouse' | 'equipped';
export type InventoryChangeKind = 'drop' | 'transfer' | 'equip' | 'unequip';
interface Hot { x: number; y: number; w: number; h: number; kind: string; zone?: Zone; id?: string; slot?: EquipSlot; char?: CharacterId; }
type ListZone = 'backpack' | 'warehouse';
interface ScrollArea { x: number; y: number; w: number; h: number; contentH: number; maxScroll: number; }
interface DragState { item: EquipItem; zone: Zone; id?: string; slot?: EquipSlot; x: number; y: number; }
interface TouchState {
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    hit: Hot | null;
    scrollZone: ListZone | null;
    moved: boolean;
    scrolling: boolean;
    drag: DragState | null;
}

const CELL = 92, GAP = 8, COLS = 3;
const ROW = CELL + GAP;
const DRAG_THRESHOLD = 10;
const PRESS_SCALE = 0.94;

export class InventoryView {
    private root: Node;
    private gfx: Graphics;
    private labelPool: Label[] = [];
    private hots: Hot[] = [];
    private scrollAreas: Partial<Record<ListZone, ScrollArea>> = {};
    private scroll: Record<ListZone, number> = { backpack: 0, warehouse: 0 };
    private touch: TouchState | null = null;
    private sel: { zone: Zone; id?: string; slot?: EquipSlot } | null = null;
    private pressed: Hot | null = null;
    private activeChar: CharacterId = CHARACTERS[0];   // 当前选中的角色（装备栏归它）
    private toast = '';
    private toastT = 0;

    constructor(
        private parent: Node,
        private halfW: number,
        private halfH: number,
        private model: InventoryModel,
        private onChanged: (kind: InventoryChangeKind) => void,
        private onDrop?: () => OpResult,
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
        this.root.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.root.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.root.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.root.on(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    isOpen(): boolean { return this.root.active; }
    toggle(): void {
        this.root.active = !this.root.active;
        if (this.root.active) {
            this.root.setSiblingIndex(this.parent.children.length - 1);  // 置顶，盖住战斗渲染与按钮
            this.sel = null;
            this.pressed = null;
            this.render();
        } else {
            this.pressed = null;
        }
    }
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
        this.scrollAreas = {};
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
            const hot = { x: cx, y: charY, w: 96, h: 40, kind: 'char', char: c } as Hot;
            const r = this.pressRect(cx, charY, 96, 40, this.isPressed(hot));
            g.fillColor = on ? new Color(90, 120, 160) : new Color(55, 60, 72);
            g.roundRect(r.x, r.y, r.w, r.h, 6); g.fill();
            if (on) { g.strokeColor = new Color(255, 230, 120); g.lineWidth = 3; g.roundRect(r.x, r.y, r.w, r.h, 6); g.stroke(); }
            lbl(cx + 48, charY + 20, CHARACTER_LABEL[c], 18);
            this.hots.push(hot);
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
            const hot = { x: ex, y: topY, w: CELL, h: CELL, kind: 'cell', zone: 'equipped', slot } as Hot;
            this.drawCell(g, ex, topY, it, this.sel?.zone === 'equipped' && this.sel.slot === slot, this.isPressed(hot));
            lbl(ex + CELL / 2, topY + CELL + 2, SLOT_LABEL[slot], 14, new Color(170, 170, 180));
            if (it) {
                lbl(ex + CELL / 2, topY + CELL / 2 + 12, it.name, 15);
                const st = formatEquipStats(it.stats);
                if (st) lbl(ex + CELL / 2, topY + CELL / 2 - 12, st, 12);
            }
            this.hots.push(hot);
            ex += CELL + GAP;
        }

        // —— 中部：左背包 / 右仓库 ——
        const midTop = topY - 60;
        // —— 底部：选中装备详情 + 按钮 ——
        const by = -this.halfH + 50;
        this.drawDetails(g, lbl, -this.halfW + 20, by + 58, this.halfW * 2 - 40, 128);
        const gridBottom = by + 210;
        const gridW = COLS * CELL + (COLS - 1) * GAP;
        const listGap = 28;
        const leftX = -gridW - listGap / 2;
        const rightX = listGap / 2;
        this.drawGrid(g, lbl, 'backpack', leftX, midTop, gridBottom, `背包 ${this.model.backpack.length}/${this.model.maxBackpack}`, this.model.backpack);
        this.drawGrid(g, lbl, 'warehouse', rightX, midTop, gridBottom, `仓库 ${this.model.warehouse.length}/${this.model.maxWarehouse}`, this.model.warehouse);

        const btn = (x: number, s: string, kind: string) => {
            const hot = { x, y: by, w: 110, h: 44, kind } as Hot;
            const r = this.pressRect(x, by, 110, 44, this.isPressed(hot));
            g.fillColor = new Color(60, 66, 80); g.roundRect(r.x, r.y, r.w, r.h, 8); g.fill();
            lbl(x + 55, by + 22, s, 18);
            this.hots.push(hot);
        };
        btn(-this.halfW + 20, '掉落', 'drop');
        btn(-this.halfW + 140, '转移', 'transfer');
        btn(-this.halfW + 260, '穿', 'equip');
        btn(-this.halfW + 380, '脱', 'unequip');
        btn(this.halfW - 130, '关闭', 'close');

        if (this.toast) lbl(0, by + 198, this.toast, 20, new Color(255, 120, 120));
        this.drawDragPreview(g, lbl);

        // 隐藏多余 label
        for (let i = li; i < this.labelPool.length; i++) this.labelPool[i].node.active = false;
    }

    private drawGrid(g: Graphics, lbl: (x: number, y: number, s: string, size?: number, c?: Color) => void,
                     zone: ListZone, x0: number, yTop: number, yBottom: number, title: string, list: EquipItem[]) {
        const gridW = COLS * CELL + (COLS - 1) * GAP;
        const gridTop = yTop - 10;
        const visibleH = Math.max(CELL, gridTop - yBottom);
        const rows = Math.ceil(list.length / COLS);
        const contentH = Math.max(0, rows * CELL + Math.max(0, rows - 1) * GAP);
        const visibleRows = Math.max(1, Math.floor((visibleH + GAP) / ROW));
        const maxScroll = Math.max(0, (rows - visibleRows) * ROW);
        this.scroll[zone] = Math.max(0, Math.min(maxScroll, this.scroll[zone]));
        const drawScroll = Math.max(0, Math.min(maxScroll, Math.round(this.scroll[zone] / ROW) * ROW));
        this.scrollAreas[zone] = { x: x0, y: yBottom, w: gridW, h: visibleH, contentH, maxScroll };

        g.fillColor = new Color(24, 27, 36, 170);
        g.roundRect(x0 - 10, yBottom - 10, gridW + 20, visibleH + 56, 8); g.fill();
        g.strokeColor = new Color(76, 84, 102, 180);
        g.lineWidth = 2;
        g.roundRect(x0 - 10, yBottom - 10, gridW + 20, visibleH + 56, 8); g.stroke();

        lbl(x0 + gridW / 2, gridTop + 26, title, 20, new Color(200, 210, 230));
        for (let i = 0; i < list.length; i++) {
            const r = Math.floor(i / COLS), c = i % COLS;
            const x = x0 + c * ROW;
            const y = gridTop - CELL - r * ROW + drawScroll;
            if (y < yBottom || y > gridTop - CELL) continue;
            const it = list[i];
            const hot = { x, y, w: CELL, h: CELL, kind: 'cell', zone, id: it.id } as Hot;
            this.drawCell(g, x, y, it, this.sel?.zone === zone && this.sel.id === it.id, this.isPressed(hot));
            lbl(x + CELL / 2, y + CELL / 2 + 12, it.name, 15);
            const st = formatEquipStats(it.stats);
            if (st) lbl(x + CELL / 2, y + CELL / 2 - 12, st, 12);
            this.hots.push(hot);
        }

        if (maxScroll > 0) {
            const trackX = x0 + gridW + 6;
            const thumbH = Math.max(28, visibleH * (visibleH / contentH));
            const travel = visibleH - thumbH;
            const thumbY = yBottom + travel * (1 - drawScroll / maxScroll);
            g.fillColor = new Color(70, 76, 92, 180);
            g.roundRect(trackX, yBottom, 5, visibleH, 3); g.fill();
            g.fillColor = new Color(180, 190, 210, 220);
            g.roundRect(trackX - 1, thumbY, 7, thumbH, 4); g.fill();
        }
    }

    private snapScroll(zone: ListZone) {
        const area = this.scrollAreas[zone];
        if (!area || area.maxScroll <= 0) {
            this.scroll[zone] = 0;
            return;
        }
        const snapped = Math.round(this.scroll[zone] / ROW) * ROW;
        this.scroll[zone] = Math.max(0, Math.min(area.maxScroll, snapped));
    }

    private pressRect(x: number, y: number, w: number, h: number, pressed: boolean): { x: number; y: number; w: number; h: number } {
        if (!pressed) return { x, y, w, h };
        const nw = w * PRESS_SCALE;
        const nh = h * PRESS_SCALE;
        return { x: x + (w - nw) / 2, y: y + (h - nh) / 2, w: nw, h: nh };
    }

    private sameHot(a: Hot | null, b: Hot | null): boolean {
        if (!a || !b) return false;
        return a.kind === b.kind && a.zone === b.zone && a.id === b.id && a.slot === b.slot && a.char === b.char;
    }

    private isPressed(hot: Hot): boolean {
        return this.sameHot(this.pressed, hot);
    }

    private clearPressed(render = true) {
        if (!this.pressed) return;
        this.pressed = null;
        if (render) this.render();
    }

    private drawCell(g: Graphics, x: number, y: number, it: EquipItem | null, selected: boolean, pressed = false) {
        const r = this.pressRect(x, y, CELL, CELL, pressed);
        if (it) { const c = QUALITY_COLOR[it.quality]; g.fillColor = new Color(c[0], c[1], c[2], 220); }
        else g.fillColor = new Color(50, 54, 64, 200);
        g.roundRect(r.x, r.y, r.w, r.h, 6); g.fill();
        g.strokeColor = selected ? new Color(255, 230, 120) : new Color(90, 96, 110);
        g.lineWidth = selected ? 4 : 2; g.roundRect(r.x, r.y, r.w, r.h, 6); g.stroke();
    }

    private drawDragPreview(g: Graphics, lbl: (x: number, y: number, s: string, size?: number, c?: Color) => void) {
        const d = this.touch?.drag;
        if (!d) return;
        const x = d.x - CELL / 2, y = d.y - CELL / 2;
        this.drawCell(g, x, y, d.item, true);
        lbl(d.x, d.y + 10, d.item.name, 15);
        const st = formatEquipStats(d.item.stats);
        if (st) lbl(d.x, d.y - 14, st, 12);
    }

    private selectedItem(): EquipItem | null {
        if (!this.sel) return null;
        if (this.sel.zone === 'equipped' && this.sel.slot) return this.model.equipped[this.activeChar][this.sel.slot];
        if (!this.sel.id) return null;
        const list = this.sel.zone === 'backpack' ? this.model.backpack : this.model.warehouse;
        return list.find(it => it.id === this.sel!.id) ?? null;
    }

    private statsDelta(next: EquipStats | undefined, cur: EquipStats | undefined): EquipStats {
        const out: EquipStats = {};
        for (const k of STAT_ORDER) {
            const d = (next?.[k] ?? 0) - (cur?.[k] ?? 0);
            if (Math.abs(d) > 0.00001) out[k] = Number(d.toFixed(4));
        }
        return out;
    }

    private drawDetails(
        g: Graphics,
        lbl: (x: number, y: number, s: string, size?: number, c?: Color) => void,
        x: number,
        y: number,
        w: number,
        h: number,
    ) {
        g.fillColor = new Color(28, 31, 40, 230);
        g.roundRect(x, y, w, h, 8); g.fill();
        g.strokeColor = new Color(82, 90, 110, 230);
        g.lineWidth = 2;
        g.roundRect(x, y, w, h, 8); g.stroke();

        const item = this.selectedItem();
        if (!item) {
            const empty = this.sel?.zone === 'equipped' ? '该装备栏为空' : '选中装备查看完整属性';
            lbl(x + w / 2, y + h / 2, empty, 18, new Color(180, 185, 198));
            return;
        }

        const qColor = QUALITY_COLOR[item.quality];
        const titleColor = new Color(qColor[0], qColor[1], qColor[2]);
        lbl(x + 80, y + h - 28, `${QUALITY_LABEL[item.quality]} · ${item.name}`, 20, titleColor);
        lbl(x + 82, y + h - 54, `${SLOT_LABEL[item.slot]}  ${this.sel?.zone === 'equipped' ? '已穿戴' : `给${CHARACTER_LABEL[this.activeChar]}对比`}`, 15, new Color(190, 198, 214));

        const current = this.sel?.zone === 'equipped' ? null : this.model.equipped[this.activeChar][item.slot];
        const delta = current ? this.statsDelta(item.stats, current.stats) : {};
        let line = 0;
        for (const k of STAT_ORDER) {
            const v = item.stats?.[k];
            if (!v) continue;
            const col = line % 2;
            const row = Math.floor(line / 2);
            const lx = x + 260 + col * 210;
            const ly = y + h - 30 - row * 26;
            const d = delta[k];
            const text = `${STAT_LABEL[k]} +${formatStatValue(k, v)}${d ? ` (${formatSignedStatValue(k, d)})` : ''}`;
            const color = d === undefined ? new Color(230, 232, 238) : (d >= 0 ? new Color(110, 230, 145) : new Color(255, 120, 120));
            lbl(lx, ly, text, 15, color);
            line++;
        }
        if (current) {
            lbl(x + 120, y + 22, `当前：${current.name}`, 14, new Color(155, 160, 176));
        }
    }

    private localPoint(e: EventTouch): Vec3 {
        const ui = e.getUILocation();
        return this.root.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
    }

    private hitAt(p: Vec3): Hot | null {
        return this.hots.find(h => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) ?? null;
    }

    private scrollZoneAt(p: Vec3): ListZone | null {
        for (const z of ['backpack', 'warehouse'] as ListZone[]) {
            const a = this.scrollAreas[z];
            if (a && p.x >= a.x && p.x <= a.x + a.w && p.y >= a.y && p.y <= a.y + a.h) return z;
        }
        return null;
    }

    private itemFromHot(hit: Hot | null): EquipItem | null {
        if (!hit || hit.kind !== 'cell') return null;
        if (hit.zone === 'equipped' && hit.slot) return this.model.equipped[this.activeChar][hit.slot];
        if (!hit.id) return null;
        const list = hit.zone === 'backpack' ? this.model.backpack : this.model.warehouse;
        return list.find(it => it.id === hit.id) ?? null;
    }

    private onTouchStart(e: EventTouch) {
        if (!this.root.active) return;
        const p = this.localPoint(e);
        const hit = this.hitAt(p);
        this.pressed = hit;
        this.touch = {
            startX: p.x, startY: p.y, lastX: p.x, lastY: p.y,
            hit,
            scrollZone: this.scrollZoneAt(p),
            moved: false,
            scrolling: false,
            drag: null,
        };
        if (hit) this.render();
    }

    private onTouchMove(e: EventTouch) {
        if (!this.touch) return;
        const p = this.localPoint(e);
        const dx = p.x - this.touch.startX;
        const dy = p.y - this.touch.startY;
        const stepY = p.y - this.touch.lastY;
        const dist2 = dx * dx + dy * dy;
        if (dist2 > DRAG_THRESHOLD * DRAG_THRESHOLD) this.touch.moved = true;
        if (this.pressed && (this.touch.moved || !this.sameHot(this.pressed, this.hitAt(p)))) {
            this.clearPressed();
        }

        if (!this.touch.drag && !this.touch.scrolling && this.touch.moved) {
            const item = this.itemFromHot(this.touch.hit);
            if (item) {
                const h = this.touch.hit!;
                const selected = this.sel?.zone === h.zone && this.sel?.id === h.id && this.sel?.slot === h.slot;
                if (selected || !this.touch.scrollZone) {
                    this.touch.drag = {
                        item,
                        zone: h.zone!,
                        id: h.id,
                        slot: h.slot,
                        x: p.x,
                        y: p.y,
                    };
                    this.sel = { zone: h.zone!, id: h.id, slot: h.slot };
                } else {
                    this.touch.scrolling = true;
                }
            } else if (this.touch.scrollZone) {
                this.touch.scrolling = true;
            }
        }

        if (this.touch.drag) {
            this.touch.drag.x = p.x;
            this.touch.drag.y = p.y;
            this.render();
        } else if (this.touch.scrolling && this.touch.scrollZone) {
            const z = this.touch.scrollZone;
            const area = this.scrollAreas[z];
            if (area) {
                this.scroll[z] = Math.max(0, Math.min(area.maxScroll, this.scroll[z] + stepY));
                this.render();
            }
        }
        this.touch.lastX = p.x;
        this.touch.lastY = p.y;
    }

    private onTouchEnd(e: EventTouch) {
        if (!this.touch) return;
        const p = this.localPoint(e);
        const t = this.touch;
        this.touch = null;
        this.pressed = null;
        if (t.drag) {
            this.finishDrag(t.drag, p);
            return;
        }
        if (t.scrolling) {
            if (t.scrollZone) this.snapScroll(t.scrollZone);
            this.render();
            return;
        }
        if (t.moved) { this.render(); return; }
        this.handleTap(t.hit);
    }

    private onTouchCancel() {
        if (!this.touch) return;
        this.touch = null;
        this.pressed = null;
        this.render();
    }

    private handleTap(hit: Hot | null) {
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

    private finishDrag(drag: DragState, p: Vec3) {
        const target = this.hitAt(p);
        const targetList = this.scrollZoneAt(p);
        let r = { ok: false, reason: '拖到装备栏、背包或仓库' } as { ok: boolean; reason?: string };
        let changed: InventoryChangeKind | null = null;

        if (target?.zone === 'equipped' && target.slot) {
            if (drag.item.slot !== target.slot) {
                r = { ok: false, reason: `这件装备只能放到${SLOT_LABEL[drag.item.slot]}` };
            } else if (drag.zone === 'backpack' && drag.id) {
                r = this.model.equip(drag.id, this.activeChar);
                changed = 'equip';
            } else if (drag.zone === 'warehouse' && drag.id) {
                r = this.model.equipFromWarehouse(drag.id, this.activeChar);
                changed = 'equip';
            } else {
                r = { ok: true };
            }
        } else if (targetList === 'backpack') {
            if (drag.zone === 'warehouse' && drag.id) {
                r = this.model.toBackpack(drag.id);
                changed = 'transfer';
            } else if (drag.zone === 'equipped' && drag.slot) {
                r = this.model.unequip(this.activeChar, drag.slot);
                changed = 'unequip';
            } else {
                r = { ok: true };
            }
        } else if (targetList === 'warehouse') {
            if (drag.zone === 'backpack' && drag.id) {
                r = this.model.toWarehouse(drag.id);
                changed = 'transfer';
            } else if (drag.zone === 'equipped' && drag.slot) {
                r = this.model.unequipToWarehouse(this.activeChar, drag.slot);
                changed = 'unequip';
            } else {
                r = { ok: true };
            }
        }

        if (!r.ok) {
            this.setToast(r.reason || '拖拽失败');
            this.sel = { zone: drag.zone, id: drag.id, slot: drag.slot };
        } else {
            this.sel = null;
            if (changed) this.onChanged(changed);
        }
        this.render();
    }

    private handleButton(kind: string) {
        const m = this.model;
        let r = { ok: true, reason: '' } as { ok: boolean; reason?: string };
        switch (kind) {
            case 'close': this.toggle(); return;
            case 'drop': r = this.onDrop ? this.onDrop() : m.dropRandom(); break;
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
        else { this.sel = null; this.onChanged(kind as InventoryChangeKind); }
        this.render();
    }
}
