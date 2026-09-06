import type { CDPSession, Page } from 'playwright-core';
import type { Input } from './input.js';
import { point, type Geometry } from './kitty.js';
export class Interaction {
  private activeModifiers = new Set<string>();
  private touch = false;
  private heldButtons=new Set<'left'|'middle'|'right'>();
  private heldKeys = new Set<string>();
  private lastClick = { x: -100, y: -100, at: 0, count: 0 };
  constructor(private page: Page, private cdp: CDPSession, private geometry: () => Geometry, private pixel: () => boolean, private mobile = false) {}
  private async mods(wanted: string[]) {
    for (const key of this.activeModifiers) if (!wanted.includes(key)) { await this.page.keyboard.up(key); this.activeModifiers.delete(key); }
    for (const key of wanted) if (!this.activeModifiers.has(key)) { await this.page.keyboard.down(key); this.activeModifiers.add(key); }
  }
  async dispatch(input: Input) {
    if (input.type === 'paste') { await this.page.keyboard.insertText(input.text); return; }
    if (input.type === 'focus') { if (!input.focused) { for (const key of this.heldKeys) await this.page.keyboard.up(key); this.heldKeys.clear(); if(this.heldButtons.size)await this.page.mouse.move(-1,-1);for(const button of this.heldButtons)await this.page.mouse.up({button});this.heldButtons.clear(); await this.mods([]); if (this.touch) { await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); this.touch = false; } } return; }
    if (input.type === 'key') {
      await this.mods(input.modifiers);
      const shifted: Record<string,string> = Object.fromEntries([..."`1234567890-=[]\\;',./"].map((c,i)=>[c,[..."~!@#$%^&*()_+{}|:\"<>?"][i]]));
      const printable = input.text && [...input.text].length === 1 ? input.text : input.modifiers.includes('Shift') && [...input.key].length === 1 ? shifted[input.key] ?? input.key.toUpperCase() : input.key;
      const key = printable === ' ' ? 'Space' : printable;
      if ([...input.key].length === 1 && input.key.codePointAt(0)! > 126) {
        const modifiers = (input.modifiers.includes('Alt') ? 1 : 0) | (input.modifiers.includes('Control') ? 2 : 0) | (input.modifiers.includes('Meta') ? 4 : 0) | (input.modifiers.includes('Shift') ? 8 : 0);
        const release = input.event === 'release';
        await this.cdp.send('Input.dispatchKeyEvent', { type:release ? 'keyUp' : 'keyDown', key:input.key, modifiers, ...(!release ? { text:input.text || input.key } : {}) });
        if (!input.held) await this.cdp.send('Input.dispatchKeyEvent', { type:'keyUp', key:input.key, modifiers });
      } else if (input.event === 'release') { await this.page.keyboard.up(key); this.heldKeys.delete(key); }
      else if (input.held) { await this.page.keyboard.down(key); this.heldKeys.add(key); }
      else await this.page.keyboard.press(key);
      if (!input.held) await this.mods([]);
      return;
    }
    if (input.type !== 'mouse') return;
    const g = this.geometry(), view = this.page.viewportSize()!;
    const rawX = this.pixel() ? input.x - 1 : (input.x - .5) * g.cellWidth;
    const rawY = this.pixel() ? input.y - 1 : (input.y - .5) * g.cellHeight;
    if (!input.release && !this.touch && (rawX >= g.columns*g.cellWidth || rawY >= g.rows*g.cellHeight)) return;
    const { x, y } = point(input.x, input.y, this.pixel(), g, view);
    const code = input.code, button = (['left', 'middle', 'right'] as const)[code & 3];
    await this.mods([...(code & 4 ? ['Shift'] : []), ...(code & 8 ? ['Alt'] : []), ...(code & 16 ? ['Control'] : [])]);
    if (code & 64) {
      await this.page.mouse.move(x, y);
      const horizontal = !!(code & 2), delta = code & 1 ? 100 : -100;
      await this.page.mouse.wheel(horizontal ? delta : 0, horizontal ? 0 : delta); return;
    }
    if (this.mobile && button === 'left') {
      if (input.release) { if (this.touch) await this.cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] }); this.touch = false; }
      else if (code & 32) { if (this.touch) await this.cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{ x, y, id:0 }] }); }
      else { this.touch = true; await this.cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{ x, y, id:0 }] }); }
      return;
    }
    await this.page.mouse.move(x, y);
    if (code & 32) return;
    if (!button) return;
    if (input.release) {await this.page.mouse.up({ button, clickCount: this.lastClick.count || 1 });this.heldButtons.delete(button);}
    else {
      const now = Date.now(), last = this.lastClick;
      const count = now - last.at < 500 && Math.hypot(x - last.x, y - last.y) < 4 ? last.count % 3 + 1 : 1;
      this.lastClick = { x, y, at:now, count };
      await this.page.mouse.down({ button, clickCount:count });this.heldButtons.add(button);
    }
  }
}
