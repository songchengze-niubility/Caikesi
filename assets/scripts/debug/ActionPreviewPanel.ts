import { ArtManifest } from '../art/ArtManifest';
import { ensureDebugDock } from './DebugDock';

export interface ActionPreviewRequest {
    key: string;
    height: number;
    x: number;
    floorY: number;
}

const PANEL_ID = 'action-preview-panel';
const STORE_KEY = 'cgame-action-preview';

function frameKeys(): string[] {
    return Object.keys(ArtManifest)
        .filter(key => ArtManifest[key].type === 'frames')
        .sort();
}

function readSaved(defaultKey: string): ActionPreviewRequest {
    const fallback: ActionPreviewRequest = { key: defaultKey, height: 300, x: 0, floorY: -260 };
    const storage = (globalThis as any).localStorage;
    if (!storage) return fallback;
    try {
        const saved = JSON.parse(storage.getItem(STORE_KEY) || '{}');
        return {
            key: typeof saved.key === 'string' ? saved.key : fallback.key,
            height: Number.isFinite(saved.height) ? saved.height : fallback.height,
            x: Number.isFinite(saved.x) ? saved.x : fallback.x,
            floorY: Number.isFinite(saved.floorY) ? saved.floorY : fallback.floorY,
        };
    } catch {
        return fallback;
    }
}

function save(req: ActionPreviewRequest): void {
    const storage = (globalThis as any).localStorage;
    if (!storage) return;
    try {
        storage.setItem(STORE_KEY, JSON.stringify(req));
    } catch {
        // 调试面板不因存储失败中断预览。
    }
}

export function mountActionPreviewPanel(
    onPreview: (req: ActionPreviewRequest) => void,
    onHide: () => void,
): () => void {
    const doc: any = (globalThis as any).document;
    if (!doc) return () => {};

    const old = doc.getElementById(PANEL_ID);
    if (old) old.remove();

    const keys = frameKeys();
    const defaultKey = keys.indexOf('char/dps/idle') >= 0 ? 'char/dps/idle' : (keys[0] ?? '');
    const state = readSaved(defaultKey);
    if (keys.indexOf(state.key) < 0) state.key = defaultKey;

    const panel = doc.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
        'position:relative', 'width:auto', 'max-height:35vh', 'overflow-y:auto',
        'background:rgba(16,18,22,0.92)', 'color:#eee', 'font:12px/1.4 system-ui,Arial',
        'padding:8px', 'border-radius:8px',
        'box-shadow:0 4px 16px rgba(0,0,0,0.45)', 'user-select:none',
        'pointer-events:none',
    ].join(';');

    const head = doc.createElement('div');
    head.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px;pointer-events:none';
    const title = doc.createElement('b');
    title.textContent = '动作预览';
    title.style.cssText = 'flex:1;font-size:13px';
    head.appendChild(title);

    const body = doc.createElement('div');
    body.style.cssText = 'display:none;pointer-events:auto';
    const toggle = button(doc, '+', '#444', () => {
        const collapsed = body.style.display !== 'none';
        body.style.display = collapsed ? 'none' : 'block';
        panel.style.width = collapsed ? 'auto' : '272px';
        toggle.textContent = collapsed ? '+' : '-';
    });
    head.appendChild(toggle);
    panel.appendChild(head);
    panel.appendChild(body);

    const keySelect = doc.createElement('select');
    keySelect.style.cssText = inputStyle();
    for (const key of keys) {
        const option = doc.createElement('option');
        option.value = key;
        option.textContent = key;
        keySelect.appendChild(option);
    }
    keySelect.value = state.key;
    body.appendChild(label(doc, '动作键', keySelect));

    const height = numberInput(doc, state.height, 80, 640, 10);
    const x = numberInput(doc, state.x, -420, 420, 10);
    const floorY = numberInput(doc, state.floorY, -760, 760, 10);
    body.appendChild(label(doc, '高度', height));
    body.appendChild(label(doc, '位置 X', x));
    body.appendChild(label(doc, '落地 Y', floorY));

    const status = doc.createElement('div');
    status.textContent = keys.length ? '选择动作后点预览' : 'ArtManifest 里没有序列帧';
    status.style.cssText = 'margin:6px 0;color:#aaa;font-size:11px;overflow-wrap:anywhere';
    body.appendChild(status);

    const row = doc.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;margin-top:8px';
    row.appendChild(button(doc, '预览', '#2e7d32', () => {
        const req = current();
        save(req);
        status.textContent = req.key;
        onPreview(req);
    }));
    row.appendChild(button(doc, '隐藏', '#5d4037', () => {
        status.textContent = '已隐藏';
        onHide();
    }));
    body.appendChild(row);

    const hint = doc.createElement('div');
    hint.textContent = '用于检查游戏内 SpriteFrame/.meta/缩放效果；不会改变战斗逻辑。';
    hint.style.cssText = 'margin-top:6px;color:#888;font-size:10px';
    body.appendChild(hint);

    function current(): ActionPreviewRequest {
        return {
            key: keySelect.value,
            height: Number(height.value || 300),
            x: Number(x.value || 0),
            floorY: Number(floorY.value || -260),
        };
    }

    const livePreview = () => {
        const req = current();
        save(req);
        onPreview(req);
    };
    keySelect.onchange = livePreview;
    height.oninput = livePreview;
    x.oninput = livePreview;
    floorY.oninput = livePreview;

    ensureDebugDock(doc).appendChild(panel);
    onHide();
    return () => panel.remove();
}

function label(doc: any, text: string, control: any): any {
    const wrap = doc.createElement('label');
    wrap.style.cssText = 'display:grid;gap:4px;margin:6px 0';
    const span = doc.createElement('span');
    span.textContent = text;
    span.style.cssText = 'color:#bbb;font-size:11px';
    wrap.appendChild(span);
    wrap.appendChild(control);
    return wrap;
}

function numberInput(doc: any, value: number, min: number, max: number, step: number): any {
    const input = doc.createElement('input');
    input.type = 'number';
    input.value = String(value);
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.style.cssText = inputStyle();
    return input;
}

function button(doc: any, text: string, bg: string, onClick: () => void): any {
    const btn = doc.createElement('button');
    btn.textContent = text;
    btn.style.cssText = `background:${bg};color:#fff;border:0;border-radius:5px;padding:4px 8px;cursor:pointer;font-size:11px;pointer-events:auto`;
    btn.onclick = onClick;
    return btn;
}

function inputStyle(): string {
    return [
        'width:100%', 'box-sizing:border-box', 'background:#2a2d36', 'color:#fff',
        'border:1px solid #444', 'border-radius:4px', 'padding:3px 5px', 'font-size:12px',
    ].join(';');
}
