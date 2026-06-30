// 代码驱动序列帧播放器：按 fps 定时切 Sprite 的 spriteFrame。不依赖编辑器 AnimationClip。
import { Color, Sprite, SpriteFrame } from 'cc';
import { frameAt, frameBlendAt } from './FrameClock';

export class FrameAnimPlayer {
    private elapsed = 0;
    constructor(
        private sprite: Sprite,
        private frames: SpriteFrame[],
        private fps: number,
        private loop: boolean,
        private pingpong = false,
        private blendSprite: Sprite | null = null,
        private blend = 0,
    ) {
        if (frames.length) sprite.spriteFrame = frames[0];
        if (blendSprite) blendSprite.node.active = false;
    }
    update(dt: number): void {
        if (this.frames.length <= 1) return;
        this.elapsed += dt;
        if (!this.blendSprite || this.blend <= 0) {
            this.sprite.spriteFrame = this.frames[frameAt(this.elapsed, this.fps, this.frames.length, this.loop, this.pingpong)];
            return;
        }
        const b = frameBlendAt(this.elapsed, this.fps, this.frames.length, this.loop, this.pingpong, this.blend);
        this.sprite.spriteFrame = this.frames[b.from];
        if (b.alpha <= 0) {
            this.blendSprite.node.active = false;
            return;
        }
        this.blendSprite.node.active = true;
        this.blendSprite.spriteFrame = this.frames[b.to];
        this.blendSprite.color = new Color(255, 255, 255, Math.round(255 * b.alpha));
    }
}
