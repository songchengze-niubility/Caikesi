import { Color, EventTouch, Graphics, Label, Node, Sprite, SpriteFrame, UITransform, Vec3 } from 'cc';
import type { ArtRegistry } from '../art/ArtRegistry';

interface UiRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

interface BootSpriteDef {
    key: string;
    rect: UiRect;
    name: string;
}

export interface BootViewOptions {
    host: Node;
    halfW: number;
    halfH: number;
    styleScale: number;
    art: ArtRegistry<SpriteFrame>;
    currentAccount: () => string;
    notice: () => string;
    onAccount: () => void;
    onStart: () => void;
}

const UI_REF_W = 941;
const UI_REF_H = 1672;
const PRESS_SCALE = 0.94;

const BOOT_UI_RECTS = {
    background: { x: 0, y: 0, w: 941, h: 1672 },
    loadingRing: { x: 275, y: 943, w: 409, h: 332 },
    loadingProgress: { x: 40, y: 1331, w: 900, h: 90 },
    fade: { x: 0, y: 1168, w: 941, h: 504 },
    notice: { x: 15, y: 2, w: 89, h: 245 },
    title: { x: 123, y: 307, w: 711, h: 283 },
    startButton: { x: 229, y: 1266, w: 466, h: 135 },
    ageRating: { x: 22, y: 1452, w: 144, h: 181 },
};

const BOOT_LOADING_UI_SPRITES: BootSpriteDef[] = [
    { key: 'ui/boot/background', rect: BOOT_UI_RECTS.background, name: 'BootLoadingBackground' },
    { key: 'ui/boot/loading_ring', rect: BOOT_UI_RECTS.loadingRing, name: 'BootLoadingRing' },
    { key: 'ui/boot/loading_progress', rect: BOOT_UI_RECTS.loadingProgress, name: 'BootLoadingProgress' },
];

const BOOT_UI_SPRITES: BootSpriteDef[] = [
    { key: 'ui/boot/background', rect: BOOT_UI_RECTS.background, name: 'BootBackground' },
    { key: 'ui/boot/bottom_fade', rect: BOOT_UI_RECTS.fade, name: 'BootBottomFade' },
    { key: 'ui/boot/notice', rect: BOOT_UI_RECTS.notice, name: 'BootNotice' },
    { key: 'ui/boot/title', rect: BOOT_UI_RECTS.title, name: 'BootTitleArt' },
    { key: 'ui/boot/start_button', rect: BOOT_UI_RECTS.startButton, name: 'BootStartButtonArt' },
    { key: 'ui/boot/age_rating', rect: BOOT_UI_RECTS.ageRating, name: 'BootAgeRating' },
];

export const BOOT_LOADING_UI_KEYS = [...new Set(BOOT_LOADING_UI_SPRITES.map(sprite => sprite.key))];
export const BOOT_UI_KEYS = BOOT_UI_SPRITES.map(sprite => sprite.key);

type BootPhase = 'loading' | 'ready' | 'playing';

export class BootView {
    private readonly root: Node;
    private readonly gfx: Graphics;
    private readonly spritesRoot: Node;
    private readonly title: Label;
    private readonly hint: Label;
    private readonly button: Label;
    private readonly accountLabel: Label;
    private phase: BootPhase = 'loading';
    private buttonRect: { x: number; y: number; w: number; h: number } | null = null;
    private accountRect: { x: number; y: number; w: number; h: number } | null = null;
    private pressed = false;

    constructor(private readonly options: BootViewOptions) {
        this.root = new Node('BootFlow');
        this.root.layer = options.host.layer;
        this.root.addComponent(UITransform).setContentSize(options.halfW * 2, options.halfH * 2);

        const gfxNode = new Node('BootGfx');
        gfxNode.layer = this.root.layer;
        gfxNode.addComponent(UITransform);
        this.gfx = gfxNode.addComponent(Graphics);
        this.root.addChild(gfxNode);

        this.spritesRoot = new Node('BootSprites');
        this.spritesRoot.layer = this.root.layer;
        this.spritesRoot.addComponent(UITransform).setContentSize(options.halfW * 2, options.halfH * 2);
        this.root.addChild(this.spritesRoot);

        this.title = this.makeLabel('BootTitle');
        this.hint = this.makeLabel('BootHint');
        this.button = this.makeLabel('BootButton');
        this.accountLabel = this.makeLabel('BootAccount');

        this.root.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.root.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.root.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.root.on(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        options.host.addChild(this.root);
        this.root.setPosition(0, 0, 0);
        this.showLoading();
    }

    isLoading(): boolean {
        return this.phase === 'loading';
    }

    showLoading(): void {
        this.phase = 'loading';
        this.buttonRect = null;
        this.accountRect = null;
        this.accountLabel.node.active = false;
        this.pressed = false;
        this.drawPanel();
        if (this.loadingArtReady()) {
            this.setLabelsActive(false);
            this.drawArtLoadingScreen();
            this.bringToTop();
            return;
        }
        this.setLabelsActive(true);
        this.placeLabel(this.title, 'Caikesi', 0, 88, 520, 80, 48, new Color(58, 48, 36));
        this.placeLabel(this.hint, '加载战斗资源中...', 0, 18, 520, 48, 25, new Color(83, 74, 62));
        this.placeLabel(this.button, '请稍候', 0, -92, 240, 52, 24, new Color(132, 120, 104));
    }

    showReady(): void {
        if (this.phase === 'playing') return;
        this.phase = 'ready';
        if (this.artReady()) {
            this.setLabelsActive(false);
            this.drawArtStartScreen();
            this.bringToTop();
            return;
        }

        this.drawPanel();
        this.setLabelsActive(true);
        this.placeLabel(this.title, 'Caikesi', 0, 108, 520, 84, 50, new Color(58, 48, 36));
        this.placeLabel(this.hint, this.options.notice() || '资源已就绪', 0, 36, 600, 48, 24, new Color(83, 74, 62));

        const buttonW = 260;
        const buttonH = 64;
        const buttonX = -buttonW / 2;
        const buttonY = -116;
        this.buttonRect = { x: buttonX, y: buttonY, w: buttonW, h: buttonH };
        const rect = this.pressRect(buttonX, buttonY, buttonW, buttonH, this.pressed);
        this.gfx.fillColor = new Color(74, 96, 76, 245);
        this.gfx.roundRect(rect.x, rect.y, rect.w, rect.h, 8);
        this.gfx.fill();
        this.gfx.strokeColor = new Color(236, 220, 160, 230);
        this.gfx.lineWidth = 2;
        this.gfx.roundRect(rect.x, rect.y, rect.w, rect.h, 8);
        this.gfx.stroke();
        this.placeLabel(this.button, '开始游戏', 0, buttonY + buttonH / 2, buttonW, buttonH, 28, new Color(248, 244, 226));
        this.drawAccountRow(0, buttonY - 44, new Color(83, 74, 62));
        this.bringToTop();
    }

    destroy(): void {
        this.root.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.root.off(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.root.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.root.off(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    private makeLabel(name: string): Label {
        const node = new Node(name);
        node.layer = this.root.layer;
        node.addComponent(UITransform);
        const label = node.addComponent(Label);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        this.root.addChild(node);
        return label;
    }

    private placeLabel(label: Label, text: string, x: number, y: number, w: number, h: number, size: number, color: Color): void {
        label.node.getComponent(UITransform)!.setContentSize(w, h);
        label.node.setPosition(x, y, 0);
        label.string = text;
        label.fontSize = size;
        label.lineHeight = size + 8;
        label.color = color;
    }

    private drawPanel(): void {
        this.spritesRoot.removeAllChildren();
        const g = this.gfx;
        g.clear();
        g.fillColor = new Color(20, 24, 24, 255);
        g.rect(-this.options.halfW, -this.options.halfH, this.options.halfW * 2, this.options.halfH * 2);
        g.fill();

        const stageW = UI_REF_W * this.options.styleScale;
        const stageH = UI_REF_H * this.options.styleScale;
        const panelW = Math.min(680, stageW - 120);
        const panelH = Math.min(430, stageH - 360);
        const x = -panelW / 2;
        const y = -panelH / 2;
        g.fillColor = new Color(234, 226, 204, 248);
        g.roundRect(x, y, panelW, panelH, 8);
        g.fill();
        g.strokeColor = new Color(116, 96, 72, 230);
        g.lineWidth = 3;
        g.roundRect(x, y, panelW, panelH, 8);
        g.stroke();
    }

    private artReady(): boolean {
        return BOOT_UI_KEYS.every(key => !!this.options.art.getSprite(key));
    }

    private loadingArtReady(): boolean {
        return BOOT_LOADING_UI_KEYS.every(key => !!this.options.art.getSprite(key));
    }

    private drawArtLoadingScreen(): void {
        this.drawBlackBackground();
        this.spritesRoot.removeAllChildren();
        for (const sprite of BOOT_LOADING_UI_SPRITES) this.addSprite(sprite);
    }

    private drawArtStartScreen(): void {
        this.drawBlackBackground();
        this.spritesRoot.removeAllChildren();
        for (const sprite of BOOT_UI_SPRITES) {
            const node = this.addSprite(sprite);
            if (sprite.name === 'BootStartButtonArt' && node && this.pressed) node.setScale(PRESS_SCALE, PRESS_SCALE, 1);
        }
        const rect = this.sourceRect(BOOT_UI_RECTS.startButton);
        this.buttonRect = { x: rect.x - rect.w / 2, y: rect.y - rect.h / 2, w: rect.w, h: rect.h };
        this.drawAccountRow(0, rect.y - rect.h / 2 - 40, new Color(240, 232, 210));
    }

    private drawBlackBackground(): void {
        this.gfx.clear();
        this.gfx.fillColor = new Color(0, 0, 0, 255);
        this.gfx.rect(-this.options.halfW, -this.options.halfH, this.options.halfW * 2, this.options.halfH * 2);
        this.gfx.fill();
    }

    private drawAccountRow(x: number, y: number, color: Color): void {
        this.accountLabel.node.active = true;
        this.placeLabel(this.accountLabel, `账号：${this.options.currentAccount()}  [切换]`, x, y, 520, 40, 22, color);
        this.accountRect = { x: x - 130, y: y - 20, w: 260, h: 40 };
    }

    private addSprite(spriteDef: BootSpriteDef): Node | null {
        const frame = this.options.art.getSprite(spriteDef.key);
        if (!frame) return null;
        const node = new Node(spriteDef.name);
        node.layer = this.root.layer;
        const box = this.sourceRect(spriteDef.rect);
        node.setPosition(box.x, box.y, 0);
        node.addComponent(UITransform).setContentSize(box.w, box.h);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.spriteFrame = frame;
        this.spritesRoot.addChild(node);
        return node;
    }

    private sourceRect(rect: UiRect): { x: number; y: number; w: number; h: number } {
        return {
            x: (rect.x + rect.w / 2 - UI_REF_W / 2) * this.options.styleScale,
            y: (UI_REF_H / 2 - rect.y - rect.h / 2) * this.options.styleScale,
            w: rect.w * this.options.styleScale,
            h: rect.h * this.options.styleScale,
        };
    }

    private setLabelsActive(active: boolean): void {
        this.title.node.active = active;
        this.hint.node.active = active;
        this.button.node.active = active;
    }

    bringToTop(): void {
        if (this.root.parent) this.root.setSiblingIndex(this.options.host.children.length - 1);
    }

    private pressRect(x: number, y: number, w: number, h: number, pressed: boolean): { x: number; y: number; w: number; h: number } {
        if (!pressed) return { x, y, w, h };
        const nw = w * PRESS_SCALE;
        const nh = h * PRESS_SCALE;
        return { x: x + (w - nw) / 2, y: y + (h - nh) / 2, w: nw, h: nh };
    }

    private buttonHit(e: EventTouch): boolean {
        if (!this.buttonRect) return false;
        const ui = e.getUILocation();
        const p = this.root.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        const rect = this.buttonRect;
        return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
    }

    private accountHit(e: EventTouch): boolean {
        if (!this.accountRect) return false;
        const ui = e.getUILocation();
        const p = this.root.getComponent(UITransform)!.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
        const rect = this.accountRect;
        return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
    }

    private onTouchStart(e: EventTouch): void {
        e.propagationStopped = true;
        if (this.phase !== 'ready') return;
        this.pressed = this.buttonHit(e);
        if (this.pressed) this.showReady();
    }

    private onTouchMove(e: EventTouch): void {
        if (this.phase !== 'ready' || !this.pressed) return;
        if (!this.buttonHit(e)) {
            this.pressed = false;
            this.showReady();
        }
    }

    private onTouchCancel(): void {
        if (!this.pressed) return;
        this.pressed = false;
        this.showReady();
    }

    private onTouchEnd(e: EventTouch): void {
        e.propagationStopped = true;
        const hit = this.buttonHit(e);
        if (this.pressed) {
            this.pressed = false;
            this.showReady();
        }
        if (this.phase === 'ready' && this.accountHit(e)) {
            this.options.onAccount();
            return;
        }
        if (this.phase !== 'ready' || !hit) return;
        this.phase = 'playing';
        this.root.active = false;
        this.options.onStart();
    }
}
