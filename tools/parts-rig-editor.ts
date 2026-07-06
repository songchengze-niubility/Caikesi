// PartsRig 动作编辑器生成器：把真图部件(base64)+当前动作参数烘进单文件 HTML。
// 用法：npm run rig:editor → temp/partsrig-demo/editor.html（双击打开）
// 编辑器导出 parts-rig-actions.json 后：npm run rig:import 回写 parts.actions.generated.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PartsRigActions } from '../assets/scripts/art/parts.actions.generated';
import { RIG_PARENTS, RIG_ACTION_IDS } from '../assets/scripts/art/PartsRigConfig';

const PARTS_DIR = path.resolve(__dirname, '..', 'temp', 'partsrig-demo', 'parts8_final');
const Z_ORDER = ['hairBack', 'armBack', 'legBack', 'legFront', 'torso', 'head', 'armFront', 'weapon'];

const metaAll = JSON.parse(fs.readFileSync(path.join(PARTS_DIR, 'parts_meta.json'), 'utf8'));
const foot = metaAll._foot.pivot;
const meta = Object.fromEntries(Object.entries(metaAll).filter(([k]) => !k.startsWith('_'))) as
    Record<string, { bbox: number[]; pivot: number[] }>;
const top = Math.min(...Object.values(meta).map((m) => m.bbox[1]));
const s = 120 / (foot[1] - top);
const parts: Record<string, unknown> = {};
for (const [id, m] of Object.entries(meta)) {
    const b64 = fs.readFileSync(path.join(PARTS_DIR, `${id}.png`)).toString('base64');
    parts[id] = {
        img: `data:image/png;base64,${b64}`,
        dx: (m.bbox[0] - m.pivot[0]) * s,
        dy: (m.bbox[1] - m.pivot[1]) * s,
        w: (m.bbox[2] - m.bbox[0]) * s,
        h: (m.bbox[3] - m.bbox[1]) * s,
        bind: { x: (m.pivot[0] - foot[0]) * s, y: (foot[1] - m.pivot[1]) * s },
    };
}

const html = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>PartsRig 动作编辑器</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #f2f0ea; display: flex; flex-direction: column; height: 100vh; }
  #bar { padding: 8px 12px; background: #fff; border-bottom: 1px solid #ddd; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  #bar button, #bar select, #bar input { font-size: 13px; }
  #bar .tab { padding: 4px 10px; border: 1px solid #bbb; background: #eee; cursor: pointer; border-radius: 4px; }
  #bar .tab.on { background: #4a7a5a; color: #fff; border-color: #4a7a5a; }
  #main { flex: 1; display: flex; min-height: 0; }
  #stage { background: #ece5d3; border-right: 1px solid #ddd; cursor: crosshair; }
  #side { width: 240px; padding: 10px; font-size: 13px; overflow-y: auto; }
  #side .p { padding: 4px 8px; margin: 2px 0; border-radius: 4px; cursor: pointer; border: 1px solid transparent; }
  #side .p.on { background: #dcebdd; border-color: #4a7a5a; font-weight: 600; }
  #vals { margin-top: 10px; color: #444; line-height: 1.8; }
  #help { margin-top: 12px; color: #999; font-size: 12px; line-height: 1.7; }
  #tl { background: #fff; border-top: 1px solid #ccc; }
</style></head><body>
<div id="bar">
  <span id="tabs"></span>
  时长<input id="dur" type="number" step="0.05" min="0.1" style="width:60px"> 秒
  <label><input id="loop" type="checkbox">循环</label>
  <button id="play">▶ 播放(空格)</button>
  <label><input id="onion" type="checkbox" checked>洋葱皮</label>
  <button id="undo">撤销(Ctrl+Z)</button>
  <button id="exp" style="background:#4a7a5a;color:#fff;border:none;padding:5px 14px;border-radius:4px">导出 JSON</button>
  <span id="msg" style="color:#4a7a5a"></span>
</div>
<div id="main">
  <canvas id="stage" width="760" height="520"></canvas>
  <div id="side">
    <b>部件（点画布或点这里选中）</b>
    <div id="plist"></div>
    <div id="vals"></div>
    <div id="help">
      <b>操作</b><br>
      点部件 = 选中；按住拖动 = 移动选中部件<br>
      滚轮 或 Q/E = 旋转 ±1°（Shift ±5°）<br>
      方向键 = 微调位置（Shift ×5）<br>
      <b>K = 在当前时间打关键帧</b><br>
      Del = 删除选中部件在此时刻的关键帧<br>
      时间轴：点击/拖动 = 定位；行 = 选部件<br>
      root 行 = 整体容器（倒地/淡出）
    </div>
  </div>
</div>
<canvas id="tl" width="1000" height="230"></canvas>
<script>
const PARTS = ${JSON.stringify(parts)};
const PARENTS = ${JSON.stringify(RIG_PARENTS)};
const ORDER = ${JSON.stringify(Z_ORDER)};
const ACTION_IDS = ${JSON.stringify(RIG_ACTION_IDS)};
let ACTIONS = ${JSON.stringify(PartsRigActions)};
const CHANNELS = ['x','y','rot','scaleX','scaleY','opacity'];
const SCALE = 2.6, FOOT = [340, 460];
const stage = document.getElementById('stage'), ctx = stage.getContext('2d');
const tl = document.getElementById('tl'), tctx = tl.getContext('2d');
const IMGS = {}, HITS = {};
let loaded = 0;
for (const id of ORDER) {
  const im = new Image();
  im.onload = () => { const c=document.createElement('canvas'); c.width=im.width; c.height=im.height;
    c.getContext('2d').drawImage(im,0,0); HITS[id]=c.getContext('2d'); if(++loaded===ORDER.length) draw(); };
  im.src = PARTS[id].img; IMGS[id] = im;
}
let actionId='idle', tn=0, playing=false, sel='armFront', pose=null, undoStack=[];
const EASE={linear:u=>u,sine:u=>0.5-0.5*Math.cos(Math.PI*u),quadIn:u=>u*u,quadOut:u=>1-(1-u)*(1-u),backOut:u=>{const c=1.70158,v=u-1;return 1+v*v*((c+1)*v+c);}};
function sampleTrack(tr,t){const{times,values}=tr;if(!times.length)return 0;if(t<=times[0])return values[0];const L=times.length-1;
  if(t>=times[L])return values[L];let i=0;while(i<L&&times[i+1]<t)i++;const span=times[i+1]-times[i];
  const u=span>0?(t-times[i])/span:1;return values[i]+(values[i+1]-values[i])*EASE[tr.ease||'sine'](u);}
function samplePart(anim,t){const r={x:0,y:0,rot:0,scaleX:1,scaleY:1,opacity:1};if(!anim)return r;
  for(const ch of CHANNELS)if(anim[ch])r[ch]=sampleTrack(anim[ch],t);return r;}
function sampleAll(t){const a=ACTIONS[actionId];const out={root:samplePart(a.root,t),parts:{}};
  for(const id of ORDER)out.parts[id]=samplePart(a.parts[id],t);
  if(pose&&pose.t===t){const tgt=pose.id==='root'?out.root:out.parts[pose.id];Object.assign(tgt,pose.v);}return out;}
const mul=(p,l)=>[p[0]*l[0]+p[2]*l[1],p[1]*l[0]+p[3]*l[1],p[0]*l[2]+p[2]*l[3],p[1]*l[2]+p[3]*l[3],p[0]*l[4]+p[2]*l[5]+p[4],p[1]*l[4]+p[3]*l[5]+p[5]];
const trs=(tx,ty,d,sx,sy)=>{const r=d*Math.PI/180,c=Math.cos(r),si=Math.sin(r);return[c*sx,si*sx,-si*sy,c*sy,tx,ty];};
const inv=m=>{const det=m[0]*m[3]-m[1]*m[2],a=m[3]/det,b=-m[1]/det,c=-m[2]/det,d=m[0]/det;return[a,b,c,d,-(a*m[4]+c*m[5]),-(b*m[4]+d*m[5])];};
function mats(smp){const M={root:trs(FOOT[0]+smp.root.x*SCALE,FOOT[1]-smp.root.y*SCALE,smp.root.rot,smp.root.scaleX,smp.root.scaleY)};
  const res=id=>{if(M[id])return M[id];const par=PARENTS[id],pm=res(par);
    const pb=par==='root'?{x:0,y:0}:PARTS[par].bind;const b=PARTS[id],p=smp.parts[id];
    return M[id]=mul(pm,trs((b.bind.x-pb.x+p.x)*SCALE,-(b.bind.y-pb.y+p.y)*SCALE,p.rot,p.scaleX,p.scaleY));};
  for(const id of ORDER)res(id);return M;}
function drawChar(smp,alpha){const M=mats(smp);
  for(const id of ORDER){const r=PARTS[id],p=smp.parts[id],m=M[id];
    ctx.setTransform(m[0],m[1],m[2],m[3],m[4],m[5]);ctx.globalAlpha=alpha*smp.root.opacity*p.opacity;
    ctx.drawImage(IMGS[id],r.dx*SCALE,r.dy*SCALE,r.w*SCALE,r.h*SCALE);}
  ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;return M;}
function draw(){ctx.clearRect(0,0,stage.width,stage.height);
  ctx.strokeStyle='#c9bfa8';ctx.beginPath();ctx.moveTo(0,FOOT[1]);ctx.lineTo(stage.width,FOOT[1]);ctx.stroke();
  if(document.getElementById('onion').checked&&tn>0.001){const p0=pose;pose=null;drawChar(sampleAll(0),0.25);pose=p0;}
  const M=drawChar(sampleAll(tn),1);
  if(sel&&sel!=='root'){const m=M[sel],r=PARTS[sel];ctx.setTransform(m[0],m[1],m[2],m[3],m[4],m[5]);
    ctx.strokeStyle='#e07a3f';ctx.lineWidth=1.5;ctx.strokeRect(r.dx*SCALE,r.dy*SCALE,r.w*SCALE,r.h*SCALE);
    ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#e07a3f';ctx.beginPath();ctx.arc(m[4],m[5],4,0,7);ctx.fill();}
  drawTl();showVals();}
function trackRowY(i){return 26+i*22;}
function drawTl(){const a=ACTIONS[actionId];tctx.clearRect(0,0,tl.width,tl.height);
  tctx.font='12px system-ui';const rows=['root',...ORDER];
  for(let i=0;i<rows.length;i++){const id=rows[i],y=trackRowY(i);
    tctx.fillStyle=id===sel?'#dcebdd':(i%2?'#fafafa':'#f0f0f0');tctx.fillRect(0,y-9,tl.width,20);
    tctx.fillStyle=id===sel?'#2a5a3a':'#555';tctx.fillText(id,8,y+4);
    const anim=id==='root'?a.root:a.parts[id];if(!anim)continue;
    const ts=new Set();for(const ch of CHANNELS)if(anim[ch])for(const t of anim[ch].times)ts.add(Math.round(t*1000)/1000);
    for(const t of ts){tctx.fillStyle='#4a7a5a';tctx.beginPath();tctx.arc(90+t*(tl.width-110),y,4,0,7);tctx.fill();}}
  const px=90+tn*(tl.width-110);tctx.strokeStyle='#e07a3f';tctx.lineWidth=2;
  tctx.beginPath();tctx.moveTo(px,10);tctx.lineTo(px,tl.height-10);tctx.stroke();
  tctx.fillStyle='#333';tctx.fillText('t='+tn.toFixed(3)+'  '+(tn*a.duration).toFixed(2)+'s',px+6,16);}
function showVals(){const smp=sampleAll(tn);const v=sel==='root'?smp.root:smp.parts[sel];
  document.getElementById('vals').innerHTML='<b>'+sel+'</b> @ t='+tn.toFixed(3)+
    '<br>rot '+v.rot.toFixed(1)+'° &nbsp; x '+v.x.toFixed(1)+' &nbsp; y '+v.y.toFixed(1)+
    '<br>scale '+v.scaleX.toFixed(2)+'/'+v.scaleY.toFixed(2)+' &nbsp; α '+v.opacity.toFixed(2)+
    (pose?'<br><span style="color:#e07a3f">未保存的姿势——按 K 打关键帧</span>':'');}
function ensurePose(){const smp=sampleAll(tn);if(!pose||pose.id!==sel||pose.t!==tn){
  const cur=sel==='root'?smp.root:smp.parts[sel];pose={id:sel,t:tn,v:{...cur}};}}
function snapshot(){undoStack.push(JSON.stringify(ACTIONS));if(undoStack.length>30)undoStack.shift();}
function commitKey(){if(!pose)return;snapshot();const a=ACTIONS[actionId];
  let anim;if(pose.id==='root'){a.root=a.root||{};anim=a.root;}else{a.parts[pose.id]=a.parts[pose.id]||{};anim=a.parts[pose.id];}
  const base=samplePart(null,0);
  for(const ch of CHANNELS){const val=pose.v[ch];
    const isDefault=Math.abs(val-base[ch])<1e-4&&!(anim[ch]&&anim[ch].times.length);if(isDefault)continue;
    anim[ch]=anim[ch]||{times:[],values:[]};const tr=anim[ch];
    let i=tr.times.findIndex(t=>Math.abs(t-pose.t)<0.02);
    if(i<0){tr.times.push(pose.t);tr.values.push(val);
      const z=tr.times.map((t,j)=>[t,tr.values[j]]).sort((p,q)=>p[0]-q[0]);
      tr.times=z.map(e=>e[0]);tr.values=z.map(e=>e[1]);}
    else tr.values[i]=val;}
  pose=null;msg('已打关键帧');draw();}
function deleteKey(){snapshot();const a=ACTIONS[actionId];
  const anim=sel==='root'?a.root:a.parts[sel];if(!anim)return;
  for(const ch of CHANNELS){const tr=anim[ch];if(!tr)continue;
    const i=tr.times.findIndex(t=>Math.abs(t-tn)<0.03);
    if(i>=0){tr.times.splice(i,1);tr.values.splice(i,1);if(!tr.times.length)delete anim[ch];}}
  pose=null;msg('已删除该时刻关键帧');draw();}
function msg(t){document.getElementById('msg').textContent=t;setTimeout(()=>document.getElementById('msg').textContent='',2000);}
// --- 交互 ---
let dragging=false,last=null;
stage.addEventListener('mousedown',e=>{const x=e.offsetX,y=e.offsetY;
  // 命中判定只负责换选中；无论是否命中，按下即可拖动当前选中部件
  try{const smp=sampleAll(tn);const M=mats(smp);
    for(let i=ORDER.length-1;i>=0;i--){const id=ORDER[i],m=M[id],r=PARTS[id];const I=inv(m);
      const lx=I[0]*x+I[2]*y+I[4],ly=I[1]*x+I[3]*y+I[5];
      const u=(lx/SCALE-r.dx)/r.w,v=(ly/SCALE-r.dy)/r.h;
      if(u>=0&&u<1&&v>=0&&v<1){const im=IMGS[id];
        const a=HITS[id].getImageData(Math.floor(u*im.width),Math.floor(v*im.height),1,1).data[3];
        if(a>20){sel=id;renderList();break;}}}
  }catch(err){msg('命中判定异常：'+err.message);}
  dragging=true;last=[x,y];draw();e.preventDefault();});
stage.addEventListener('mousemove',e=>{if(!dragging)return;ensurePose();
  pose.v.x+=(e.offsetX-last[0])/SCALE;pose.v.y-=(e.offsetY-last[1])/SCALE;last=[e.offsetX,e.offsetY];draw();});
window.addEventListener('mouseup',()=>dragging=false);
stage.addEventListener('dragstart',e=>e.preventDefault());
stage.addEventListener('wheel',e=>{e.preventDefault();ensurePose();
  pose.v.rot+=(e.deltaY>0?1:-1)*(e.shiftKey?5:1);draw();},{passive:false});
window.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT')return;
  if(e.key==='k'||e.key==='K')commitKey();
  else if(e.key==='Delete')deleteKey();
  else if(e.key===' '){e.preventDefault();togglePlay();}
  else if((e.ctrlKey||e.metaKey)&&e.key==='z'){if(undoStack.length){ACTIONS=JSON.parse(undoStack.pop());pose=null;draw();msg('已撤销');}}
  else if(e.key.startsWith('Arrow')){e.preventDefault();ensurePose();const step=e.shiftKey?5:1;
    if(e.key==='ArrowLeft')pose.v.x-=step; if(e.key==='ArrowRight')pose.v.x+=step;
    if(e.key==='ArrowUp')pose.v.y+=step; if(e.key==='ArrowDown')pose.v.y-=step; draw();}
  else if(e.key==='q'||e.key==='Q'){ensurePose();pose.v.rot-=e.shiftKey?5:1;draw();}
  else if(e.key==='e'||e.key==='E'){ensurePose();pose.v.rot+=e.shiftKey?5:1;draw();}});
let scrubbing=false;
function tlScrub(e){const r=tl.getBoundingClientRect();tn=Math.min(1,Math.max(0,(e.clientX-r.left-90)/(tl.width-110)));
  tn=Math.round(tn*1000)/1000;pose=null;
  const row=Math.round((e.clientY-r.top-26)/22);const rows=['root',...ORDER];
  if(scrubbing==='row'&&row>=0&&row<rows.length){sel=rows[row];renderList();}
  draw();}
tl.addEventListener('mousedown',e=>{scrubbing='row';tlScrub(e);scrubbing=true;});
tl.addEventListener('mousemove',e=>{if(scrubbing===true)tlScrub(e);});
window.addEventListener('mouseup',()=>scrubbing=false);
// --- 播放 ---
let rafT=null;
function togglePlay(){playing=!playing;document.getElementById('play').textContent=playing?'⏸ 暂停(空格)':'▶ 播放(空格)';
  if(playing){pose=null;rafT=performance.now();requestAnimationFrame(step);}}
function step(now){if(!playing)return;const a=ACTIONS[actionId];
  tn+=(now-rafT)/1000/a.duration;rafT=now;
  if(tn>=1)tn=a.loop?tn%1:0;
  draw();requestAnimationFrame(step);}
// --- 顶栏 ---
function renderTabs(){const el=document.getElementById('tabs');el.innerHTML='';
  for(const id of ACTION_IDS){const b=document.createElement('span');b.className='tab'+(id===actionId?' on':'');
    b.textContent=id;b.onclick=()=>{actionId=id;tn=0;pose=null;
      document.getElementById('dur').value=ACTIONS[id].duration;
      document.getElementById('loop').checked=ACTIONS[id].loop;renderTabs();draw();};el.appendChild(b);}}
function renderList(){const el=document.getElementById('plist');el.innerHTML='';
  for(const id of ['root',...ORDER]){const d=document.createElement('div');d.className='p'+(id===sel?' on':'');
    d.textContent=id;d.onclick=()=>{sel=id;pose=null;renderList();draw();};el.appendChild(d);}}
document.getElementById('dur').addEventListener('change',e=>{snapshot();ACTIONS[actionId].duration=Math.max(0.1,parseFloat(e.target.value)||0.5);draw();});
document.getElementById('loop').addEventListener('change',e=>{snapshot();ACTIONS[actionId].loop=e.target.checked;});
document.getElementById('play').onclick=togglePlay;
document.getElementById('undo').onclick=()=>{if(undoStack.length){ACTIONS=JSON.parse(undoStack.pop());pose=null;draw();msg('已撤销');}};
document.getElementById('onion').onchange=draw;
document.getElementById('exp').onclick=()=>{const data=JSON.stringify(ACTIONS,null,2);
  const blob=new Blob([data],{type:'application/json'});const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='parts-rig-actions.json';a.click();
  navigator.clipboard&&navigator.clipboard.writeText(data);msg('已导出（下载+剪贴板）');};
document.getElementById('dur').value=ACTIONS[actionId].duration;
document.getElementById('loop').checked=ACTIONS[actionId].loop;
renderTabs();renderList();
</script></body></html>
`;

const outFile = path.resolve(__dirname, '..', 'temp', 'partsrig-demo', 'editor.html');
fs.writeFileSync(outFile, html, 'utf8');
console.log(`[editor] 已生成动作编辑器 → ${outFile}`);
