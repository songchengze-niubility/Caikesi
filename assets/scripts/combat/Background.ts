// 场景背景（Background）—— 占位：多层视差滚动的蓝天/山丘/云/地面
// 分层（从远到近）：天空渐变 → 远处山丘(慢) → 云(按大小分速度) → 地面 → 地面纹理(快)。
// 各层独立滚动，营造纵深和前进感。
//
// 【替换成真实美术】：每一层都可以换成图片——给对应层一个 Sprite/TiledSprite，
//   把这里的「代码绘制」换成「贴图 + 横向滚动 uv」即可，滚动速度仍读 scene 配置。
//   现在没美术，用 Graphics 画占位。

import { Graphics, Color } from 'cc';
import { BattleConfig } from '../config/BattleConfig';

interface Cloud { x: number; y: number; s: number; }

export class Background {
    private g: Graphics;
    private halfW: number;
    private halfH: number;
    private clouds: Cloud[] = [];
    private hillX = 0;   // 山丘滚动累计
    private t = 0;       // 总时间（地面纹理滚动用）
    private _useSprite = false;

    constructor(g: Graphics, halfW: number, halfH: number) {
        this.g = g;
        this.halfW = halfW;
        this.halfH = halfH;
        this._initClouds();
    }

    private _initClouds() {
        const cfg = BattleConfig.scene.cloud;
        const h = BattleConfig.scene.horizonY;
        for (let i = 0; i < cfg.count; i++) {
            this.clouds.push({
                x: (Math.random() * 2 - 1) * this.halfW,
                y: h + (this.halfH - h) * (0.25 + Math.random() * 0.6),
                s: 0.7 + Math.random() * 0.9,   // 大小，同时决定漂移速度（近快远慢）
            });
        }
    }

    setUsingSprite(v: boolean) { this._useSprite = v; }

    update(dt: number) {
        if (this._useSprite) return;
        const S = BattleConfig.scene;
        this.t += dt;
        this.hillX += S.hill.speed * dt;
        for (const c of this.clouds) {
            c.x -= S.cloud.speed * c.s * dt;          // 大云更快 → 视差
            if (c.x < -this.halfW - 160) c.x = this.halfW + 160;
        }
        this._draw();
    }

    private _draw() {
        const S = BattleConfig.scene;
        const g = this.g;
        g.clear();

        // 天空渐变
        this._band(S.horizonY, this.halfH, S.skyBottom, S.skyTop);
        // 远处山丘（在地面之前画，下半被地面盖住，只露出地平线以上的丘顶）
        this._hills();
        // 地面渐变
        this._band(-this.halfH, S.horizonY, S.groundBottom, S.groundTop);
        // 地面纹理（两行，近的更快更大 → 视差前进感）
        this._groundRow(S.horizonY - 34, 92, 30, 7, S.groundScroll * 0.55);
        this._groundRow(-this.halfH * 0.45, 140, 54, 12, S.groundScroll);
        // 地平线高光
        g.strokeColor = new Color(255, 255, 255, 110);
        g.lineWidth = 3;
        g.moveTo(-this.halfW, S.horizonY);
        g.lineTo(this.halfW, S.horizonY);
        g.stroke();
        // 云（最近层）
        const cc = S.cloud.color;
        g.fillColor = new Color(cc[0], cc[1], cc[2], 235);
        for (const c of this.clouds) this._cloud(c);
    }

    // 水平渐变条（colorLow 在底、colorHigh 在顶）
    private _band(yLow: number, yHigh: number, colorLow: number[], colorHigh: number[]) {
        const steps = 24;
        const x = -this.halfW - 2;
        const w = this.halfW * 2 + 4;
        const h = (yHigh - yLow) / steps;
        for (let i = 0; i < steps; i++) {
            const t = i / (steps - 1);
            this.g.fillColor = new Color(
                colorLow[0] + (colorHigh[0] - colorLow[0]) * t,
                colorLow[1] + (colorHigh[1] - colorLow[1]) * t,
                colorLow[2] + (colorHigh[2] - colorLow[2]) * t,
            );
            this.g.rect(x, yLow + i * h, w, h + 1);
            this.g.fill();
        }
    }

    // 远处山丘剪影：一排圆顶，随 hillX 缓慢左移
    private _hills() {
        const S = BattleConfig.scene;
        const r = 150, period = 240;
        const baseY = S.horizonY - r + 55;   // 丘顶高出地平线约 55
        const off = ((this.hillX % period) + period) % period;
        const c = S.hill.color;
        this.g.fillColor = new Color(c[0], c[1], c[2]);
        for (let x = -this.halfW - period; x < this.halfW + period; x += period) {
            this.g.circle(x - off, baseY, r);
        }
        this.g.fill();
    }

    // 地面一行纹理（小色块），随时间向左滚
    private _groundRow(y: number, spacing: number, dashW: number, dashH: number, speed: number) {
        const off = (this.t * speed) % spacing;
        this.g.fillColor = new Color(255, 255, 255, 40);   // 浅色斑块，叠在地面上
        for (let x = -this.halfW - spacing; x < this.halfW + spacing; x += spacing) {
            this.g.rect(x - off, y, dashW, dashH);
        }
        this.g.fill();
    }

    private _cloud(c: Cloud) {
        const r = 26 * c.s;
        this.g.circle(c.x, c.y, r);
        this.g.circle(c.x - r * 0.9, c.y - r * 0.25, r * 0.7);
        this.g.circle(c.x + r * 0.95, c.y - r * 0.15, r * 0.8);
        this.g.circle(c.x + r * 0.1, c.y + r * 0.35, r * 0.65);
        this.g.fill();
    }
}
