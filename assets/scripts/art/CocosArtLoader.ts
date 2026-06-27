// 用 Cocos resources.load 实现真实加载器，产出 ArtRegistry<SpriteFrame>。
// 注意：从 resources 下的图取 SpriteFrame，子资源路径是 "<图路径>/spriteFrame"。
import { resources, SpriteFrame } from 'cc';
import { ArtRegistry } from './ArtRegistry';

function loadSpriteFrame(path: string): Promise<SpriteFrame | null> {
    return new Promise(res => {
        resources.load(path + '/spriteFrame', SpriteFrame, (err, sf) => res(err ? null : (sf as SpriteFrame)));
    });
}

export function createArtRegistry(): ArtRegistry<SpriteFrame> {
    return new ArtRegistry<SpriteFrame>(loadSpriteFrame);
}
