// PartsRig 色块 demo 预览烘焙器：采样四动作 → 烘成 JSON 嵌入 HTML（canvas 播放）。
// 用法：npx tsx tools/parts-rig-preview.ts  → 生成 temp/partsrig-demo/preview.html
// 采样器是唯一动作真源；预览页只做"按烘焙帧画色块"，不复刻动画逻辑。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PartsRigActions, PartsRigBind, RIG_ACTION_IDS, RIG_PARENTS } from '../assets/scripts/art/PartsRigConfig';
import { sampleAction } from '../assets/scripts/art/PartsRigSampler';

const SAMPLES_PER_SEC = 60;

const baked: Record<string, { duration: number; loop: boolean; frames: unknown[] }> = {};
for (const action of RIG_ACTION_IDS) {
    const def = PartsRigActions[action];
    const n = Math.max(2, Math.round(def.duration * SAMPLES_PER_SEC));
    const frames = [];
    for (let i = 0; i <= n; i++) frames.push(sampleAction(def, def.duration * i / n));
    baked[action] = { duration: def.duration, loop: def.loop, frames };
}

// 若已有拆件产物（slice_parts.py 的 parts_meta.json），预览页追加"真图行"
// 坐标换算：原图坐标 → rig 坐标（脚底原点、y 向上、角色 120px 高）
interface PartMeta { bbox: number[]; pivot: number[] }
let realParts: Record<string, { img: string; dx: number; dy: number; w: number; h: number; bind: { x: number; y: number } }> | null = null;
// 用十二件标准版（parts12_final，_foot 记录脚底基准）
const partsDirName = 'parts12_final';
const metaFile = path.resolve(__dirname, '..', 'temp', 'partsrig-demo', partsDirName, 'parts_meta.json');
if (fs.existsSync(metaFile)) {
    const metaAll: Record<string, PartMeta> = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const foot = metaAll._foot.pivot;
    const meta = Object.fromEntries(Object.entries(metaAll).filter(([k]) => !k.startsWith('_')));
    const top = Math.min(...Object.values(meta).map((m) => m.bbox[1]));
    const s = 120 / (foot[1] - top);
    realParts = {};
    for (const [id, m] of Object.entries(meta)) {
        realParts[id] = {
            img: `${partsDirName}/${id}.png`,
            dx: (m.bbox[0] - m.pivot[0]) * s,
            dy: (m.bbox[1] - m.pivot[1]) * s,
            w: (m.bbox[2] - m.bbox[0]) * s,
            h: (m.bbox[3] - m.bbox[1]) * s,
            bind: { x: (m.pivot[0] - foot[0]) * s, y: (foot[1] - m.pivot[1]) * s },
        };
    }
}

const html = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>PartsRig 色块 demo</title>
<style>
  body { font-family: system-ui, sans-serif; background: #fafafa; margin: 24px; }
  .row { display: flex; gap: 24px; flex-wrap: wrap; }
  .cell { text-align: center; }
  .label { font-size: 13px; color: #444; margin-top: 6px; font-weight: 600; }
  .stage { position: relative; width: 260px; height: 200px; border: 1px solid #ddd;
    background-image: url('../../assets/resources/art/bg/main.png');
    background-size: auto 1920px; background-position: 42% 76%; }
  canvas { position: absolute; inset: 0; }
  .note { font-size: 12px; color: #888; margin-top: 16px; max-width: 760px; line-height: 1.7; }
</style></head><body>
<h1 style="font-size:18px">PartsRig 部件缓动 · 色块 demo（角色 120px 真实比例，attack 每 0.9s 一刀，death 循环重演）</h1>
<div class="row" id="root"></div>
<p class="note">
部件：马尾(墨黑) / 躯干(淡竹绿) / 头(米白圆) / 剑(青灰条)。手感判断点：idle 呼吸是否自然、run 颠簸节奏、attack 蓄力→爆发的打击感、death 倒地重量感。<br>
调参=改 assets/scripts/art/PartsRigConfig.ts 数字后重跑 npx tsx tools/parts-rig-preview.ts。
</p>
<script>
const BAKED = ${JSON.stringify(baked)};
const BIND = ${JSON.stringify(PartsRigBind)};
const REAL = ${JSON.stringify(realParts)};
const PARENTS = ${JSON.stringify(RIG_PARENTS)};
const ORDER = Object.entries(BIND).sort((a, b) => a[1].z - b[1].z).map(([k]) => k);
// 2D 仿射矩阵 [a,b,c,d,e,f]（canvas setTransform 约定）
const mul = (p, l) => [
  p[0]*l[0] + p[2]*l[1], p[1]*l[0] + p[3]*l[1],
  p[0]*l[2] + p[2]*l[3], p[1]*l[2] + p[3]*l[3],
  p[0]*l[4] + p[2]*l[5] + p[4], p[1]*l[4] + p[3]*l[5] + p[5],
];
const trs = (tx, ty, deg, sx, sy) => {
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return [c*sx, s*sx, -s*sy, c*sy, tx, ty];
};
// 按父子链算各部件世界矩阵：子级 pivot 相对父级 pivot 定位（屏幕系 y 向下）
function worldMats(sample, footX, footY, bindOf, useBindRot) {
  const mats = { root: trs(footX + sample.root.x, footY - sample.root.y, sample.root.rot, sample.root.scaleX, sample.root.scaleY) };
  const resolve = (id) => {
    if (mats[id]) return mats[id];
    const parent = PARENTS[id];
    const pm = resolve(parent);
    const pb = parent === 'root' ? { x: 0, y: 0 } : bindOf(parent);
    const b = bindOf(id), p = sample.parts[id];
    const local = trs(b.x - pb.x + p.x, -(b.y - pb.y + p.y), (useBindRot ? (b.rot || 0) : 0) + p.rot, p.scaleX, p.scaleY);
    return (mats[id] = mul(pm, local));
  };
  for (const id of ORDER) resolve(id);
  return mats;
}
const CYCLE = { attack: 0.9, death: 2.0 };
const IMGS = {};
if (REAL) for (const id of ORDER) { const im = new Image(); im.src = REAL[id].img; IMGS[id] = im; }
const root = document.getElementById('root');
// 动作调参只看真图（色块仅在无素材时作系统调试用，不再进入验收视野）
const MODES = REAL ? ['real'] : ['blocks'];
for (const mode of MODES)
for (const action of ${JSON.stringify(RIG_ACTION_IDS)}) {
  const cell = document.createElement('div'); cell.className = 'cell';
  const stage = document.createElement('div'); stage.className = 'stage';
  const cv = document.createElement('canvas'); cv.width = 260; cv.height = 200;
  stage.appendChild(cv); cell.appendChild(stage);
  const label = document.createElement('div'); label.className = 'label';
  label.textContent = (mode === 'real' ? '真图 · ' : '色块 · ') + action;
  cell.appendChild(label); root.appendChild(cell);
  const ctx = cv.getContext('2d');
  const anim = BAKED[action];
  const start = performance.now();
  function frameAt(tSec) {
    const n = anim.frames.length - 1;
    let tn;
    if (anim.loop) tn = (tSec / anim.duration) % 1;
    else tn = Math.min(tSec / anim.duration, 1);
    return anim.frames[Math.round(tn * n)];
  }
  function draw(now) {
    const elapsed = (now - start) / 1000;
    let t = elapsed;
    const cycle = CYCLE[action];
    if (cycle) t = elapsed % cycle;   // one-shot 动作按周期重演（attack 模拟攻击间隔）
    const s = frameAt(t);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const footX = 130, footY = 180;
    const bindOf = mode === 'real' ? ((id) => REAL[id].bind) : ((id) => BIND[id]);
    const mats = worldMats(s, footX, footY, bindOf, mode !== 'real');
    for (const id of ORDER) {
      const p = s.parts[id];
      const m = mats[id];
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.globalAlpha = s.root.opacity * p.opacity;
      if (mode === 'real') {
        const r = REAL[id];
        ctx.drawImage(IMGS[id], r.dx, r.dy, r.w, r.h);
      } else {
        const b = BIND[id];
        ctx.fillStyle = b.color;
        if (b.draw === 'circle') {
          ctx.beginPath(); ctx.arc(0, -b.h / 2, b.w / 2, 0, Math.PI * 2); ctx.fill();
        } else if (b.draw === 'down') {
          ctx.fillRect(-b.w / 2, 0, b.w, b.h);
        } else if (b.draw === 'fwd') {
          ctx.fillRect(0, -b.h / 2, b.w, b.h);
        } else {
          ctx.fillRect(-b.w / 2, -b.h, b.w, b.h);
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}
</script></body></html>
`;

const outDir = path.resolve(__dirname, '..', 'temp', 'partsrig-demo');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'preview.html');
fs.writeFileSync(outFile, html, 'utf8');
// 额外吐一份烘焙数据，供离线静态渲染/调试（与 HTML 内嵌数据同源）
fs.writeFileSync(path.join(outDir, 'baked.json'), JSON.stringify({ baked, bind: PartsRigBind }), 'utf8');
console.log(`[partsrig] 已烘焙 ${Object.keys(baked).length} 个动作 → ${outFile}`);
