import { screen, Size } from 'cc';

const DOCK_ID = 'cgame-debug-dock';

function queuePreviewResize(doc: any, win: any): void {
    if (doc.__cgamePreviewResizeQueued) return;
    doc.__cgamePreviewResizeQueued = true;
    const syncWindowSize = () => {
        doc.__cgamePreviewResizeQueued = false;
        const dpr = Math.min(Number(win.devicePixelRatio) || 1, 2);
        screen.windowSize = new Size(win.innerWidth * dpr, win.innerHeight * dpr);
    };
    if (typeof win.requestAnimationFrame === 'function') {
        win.requestAnimationFrame(() => win.requestAnimationFrame(syncWindowSize));
    } else {
        win.setTimeout(syncWindowSize, 0);
    }
}

// 网页预览专用：把所有临时调试工具收进右上纵向停靠栏，避免各自 fixed 后互相覆盖。
export function ensureDebugDock(doc: any): any {
    // Creator 3.8.8 的网页全屏工具栏会在 hover 时从 flex 布局中出现，
    // 把 Canvas 整体下推 50px，却不触发游戏坐标重算，导致点击区域全局上偏。
    const creatorToolbar = doc.querySelector('body > .toolbar');
    if (creatorToolbar) {
        creatorToolbar.style.setProperty('display', 'none', 'important');
        creatorToolbar.setAttribute('aria-hidden', 'true');
    }

    // Creator 网页预览属于 SubFrame：普通 window resize 只更新容器，不会写回
    // screen.windowSize。热更新隐藏工具栏、拖动窗口或切设备尺寸后都要主动同步。
    const win = doc.defaultView;
    if (win) {
        if (!doc.__cgamePreviewResizeHandler) {
            doc.__cgamePreviewResizeHandler = () => queuePreviewResize(doc, win);
            win.addEventListener('resize', doc.__cgamePreviewResizeHandler);
        }
        if (!doc.__cgamePreviewResizeObserver && typeof win.ResizeObserver === 'function') {
            doc.__cgamePreviewResizeObserver = new win.ResizeObserver(() => queuePreviewResize(doc, win));
            doc.__cgamePreviewResizeObserver.observe(doc.documentElement);
        }
        if (!doc.__cgamePreviewSizePoll) {
            doc.__cgamePreviewWidth = win.innerWidth;
            doc.__cgamePreviewHeight = win.innerHeight;
            doc.__cgamePreviewSizePoll = win.setInterval(() => {
                if (doc.__cgamePreviewWidth === win.innerWidth && doc.__cgamePreviewHeight === win.innerHeight) return;
                doc.__cgamePreviewWidth = win.innerWidth;
                doc.__cgamePreviewHeight = win.innerHeight;
                queuePreviewResize(doc, win);
            }, 250);
        }
        queuePreviewResize(doc, win);
    }

    const existing = doc.getElementById(DOCK_ID);
    if (existing) return existing;

    const dock = doc.createElement('div');
    dock.id = DOCK_ID;
    dock.style.cssText = [
        'position:fixed', 'top:112px', 'right:8px',
        'display:flex', 'flex-direction:column', 'align-items:flex-end', 'gap:6px',
        'max-height:calc(100vh - 16px)', 'overflow-y:auto', 'overflow-x:hidden',
        'z-index:99999', 'pointer-events:none',
    ].join(';');
    doc.body.appendChild(dock);
    return dock;
}
