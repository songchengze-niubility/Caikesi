// 代码驱动序列帧播放器：按 fps 定时切 Sprite 的 spriteFrame。不依赖编辑器 AnimationClip。
import { Sprite, SpriteFrame } from 'cc';
import { frameAt } from './FrameClock';

export class FrameAnimPlayer {
    private elapsed = 0;
    constructor(
        private sprite: Sprite,
        private frames: SpriteFrame[],
        private fps: number,
        private loop: boolean,
    ) {
        if (frames.length) sprite.spriteFrame = frames[0];
    }
    update(dt: number): void {
        if (this.frames.length <= 1) return;
        this.elapsed += dt;
        this.sprite.spriteFrame = this.frames[frameAt(this.elapsed, this.fps, this.frames.length, this.loop)];
    }
}
