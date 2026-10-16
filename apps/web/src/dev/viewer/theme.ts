/**
 * The viewer's look: dark glass panels floating over the live canvas, the game's
 * gold and parchment, Marcellus for words and a mono face only for numbers.
 *
 * Plain CSS rather than inline styles because a tool lives on its states (hover,
 * focus, pressed, disabled) and on the browser surfaces inline styles cannot
 * reach: scrollbars, range thumbs, selection.
 */
import { DISPLAY, GOLD, GOLD_DIM, PARCHMENT, SERIF, EMBER } from "../../menu/frames";

export const VIEWER_CSS = `
.av {
  --av-glass: rgba(13, 12, 11, 0.74);
  --av-glass-hi: rgba(28, 25, 21, 0.86);
  --av-line: rgba(200, 164, 77, 0.16);
  --av-line-hi: rgba(200, 164, 77, 0.42);
  --av-text: ${PARCHMENT};
  --av-dim: #b0a487;
  --av-faint: #8f8570;
  --av-gold: ${GOLD};
  --av-gold-dim: ${GOLD_DIM};
  --av-ember: ${EMBER};
  --av-fill: rgba(200, 164, 77, 0.15);
  --av-serif: ${SERIF};
  --av-display: ${DISPLAY};
  --av-mono: ui-monospace, "Cascadia Mono", "SFMono-Regular", Menlo, monospace;
  position: absolute; inset: 0; background: #0d0d10; overflow: hidden;
  color: var(--av-text); font: 13px/1.35 var(--av-serif);
}
.av ::selection { background: rgba(200, 164, 77, 0.35); color: #fff6e0; }
.av canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; outline: none; }

.av-panel {
  position: absolute; z-index: 2; display: flex; flex-direction: column;
  background: var(--av-glass); border: 1px solid var(--av-line); border-radius: 10px;
  backdrop-filter: blur(14px) saturate(1.15); -webkit-backdrop-filter: blur(14px) saturate(1.15);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45), 0 1px 0 rgba(255, 236, 190, 0.04) inset;
  transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1), opacity 220ms cubic-bezier(0.16, 1, 0.3, 1);
}
.av-panel[data-hidden="true"] { opacity: 0; pointer-events: none; }
.av-left { top: 12px; left: 12px; bottom: 12px; width: 248px; }
.av-left[data-hidden="true"] { transform: translateX(-24px); }
.av-right { top: 12px; right: 12px; bottom: 12px; width: 300px; }
.av-right[data-hidden="true"] { transform: translateX(24px); }
.av-bottom { left: 272px; right: 324px; bottom: 12px; height: 52px; flex-direction: row; align-items: center; gap: 10px; padding: 0 12px; }
.av[data-left="false"] .av-bottom { left: 12px; }
.av[data-right="false"] .av-bottom { right: 12px; }

.av-head { display: flex; align-items: center; gap: 8px; padding: 12px 12px 8px; }
.av-title { font: 15px/1 var(--av-display); letter-spacing: 0.08em; color: var(--av-gold); flex: 1; }
.av-scroll { overflow-y: auto; flex: 1; padding: 0 6px 10px; scrollbar-width: thin; scrollbar-color: var(--av-gold-dim) transparent; }
.av-scroll::-webkit-scrollbar { width: 8px; }
.av-scroll::-webkit-scrollbar-thumb { background: rgba(122, 92, 34, 0.7); border-radius: 4px; border: 2px solid transparent; background-clip: padding-box; }

.av-search { margin: 0 12px 8px; position: relative; }
.av-search svg { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); color: var(--av-faint); pointer-events: none; }
.av-input {
  width: 100%; box-sizing: border-box; height: 30px; padding: 0 10px 0 30px;
  background: rgba(0, 0, 0, 0.35); color: var(--av-text); border: 1px solid var(--av-line); border-radius: 7px;
  font: 13px var(--av-serif); caret-color: var(--av-gold); user-select: text;
}
.av-input::placeholder { color: var(--av-faint); }
.av-input:focus { outline: none; border-color: var(--av-line-hi); }

.av-group { margin-top: 10px; }
.av-group-label {
  display: flex; justify-content: space-between; padding: 4px 8px 4px;
  font: 11px/1 var(--av-display); letter-spacing: 0.1em; color: var(--av-dim);
}
.av-count { font: 11px var(--av-mono); color: var(--av-faint); letter-spacing: 0; }
.av-row {
  display: block; width: 100%; text-align: left; padding: 5px 8px; margin: 1px 0; border-radius: 6px;
  background: transparent; border: 0; color: var(--av-text); font: 13px/1.25 var(--av-serif);
  cursor: pointer; text-transform: capitalize;
}
.av-row:hover { background: rgba(255, 236, 190, 0.05); }
.av-row[aria-current="true"] { background: var(--av-fill); color: var(--av-gold); }
.av-empty { padding: 12px 8px; color: var(--av-faint); }

.av-section { padding: 12px 14px 14px; border-top: 1px solid var(--av-line); }
.av-section:first-child { border-top: 0; }
.av-h { font: 12px/1 var(--av-display); letter-spacing: 0.1em; color: var(--av-gold); margin: 0 0 10px; display: flex; align-items: center; gap: 8px; }
.av-h small { font: 11px var(--av-serif); letter-spacing: 0; color: var(--av-faint); margin-left: auto; }
.av-field { display: grid; grid-template-columns: 74px 1fr; align-items: center; gap: 8px; margin-bottom: 6px; }
.av-field label { color: var(--av-dim); text-transform: capitalize; }
.av-select {
  height: 28px; padding: 0 8px; background: rgba(0, 0, 0, 0.35); color: var(--av-text);
  border: 1px solid var(--av-line); border-radius: 6px; font: 13px var(--av-serif); text-transform: capitalize;
}
.av-select:focus-visible { outline: 1px solid var(--av-gold); outline-offset: 1px; }
.av-select option { background: #17140f; }

.av-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.av-chip {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 6px;
  background: rgba(255, 236, 190, 0.03); border: 1px solid var(--av-line); color: var(--av-text);
  font: 13px var(--av-serif); cursor: pointer; white-space: nowrap;
  transition: border-color 120ms, background-color 120ms, color 120ms;
}
.av-chip:hover { border-color: var(--av-line-hi); background: rgba(255, 236, 190, 0.06); }
.av-chip:active { transform: translateY(1px); }
.av-chip[aria-pressed="true"] { background: var(--av-fill); border-color: var(--av-line-hi); color: var(--av-gold); }
.av-chip:disabled { opacity: 0.4; cursor: default; }
.av-chip kbd { font: 10px var(--av-mono); color: var(--av-faint); }
.av-chip.av-danger:hover { border-color: rgba(217, 118, 47, 0.6); color: var(--av-ember); }
.av-seg { display: flex; border: 1px solid var(--av-line); border-radius: 7px; overflow: hidden; }
.av-seg .av-chip { border: 0; border-radius: 0; flex: 1; justify-content: center; padding: 0 6px; }
.av-seg .av-chip + .av-chip { border-left: 1px solid var(--av-line); }
.av-seg-v { flex-direction: column; flex: 1; }
.av-seg-v .av-chip { flex: none; justify-content: space-between; padding: 0 10px; }
.av-seg-v .av-chip + .av-chip { border-left: 0; border-top: 1px solid var(--av-line); }
.av-dial { display: grid; grid-template-columns: repeat(3, 34px); grid-template-rows: repeat(3, 30px); gap: 4px; }
.av-dial .av-chip { padding: 0; justify-content: center; }
.av-dial-hub { display: grid; place-items: center; color: var(--av-faint); font-size: 11px; }
.av-motion { display: flex; gap: 14px; align-items: flex-start; }
.av-note { color: var(--av-faint); font-size: 12px; margin-top: 8px; }
.av-note b { color: var(--av-dim); font-weight: normal; }

.av-list { max-height: 188px; overflow-y: auto; border: 1px solid var(--av-line); border-radius: 7px; margin-top: 8px; scrollbar-width: thin; scrollbar-color: var(--av-gold-dim) transparent; }
.av-list .av-row { border-radius: 0; margin: 0; text-transform: none; }

.av-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; }
.av-stat { display: flex; justify-content: space-between; color: var(--av-dim); }
.av-stat span:last-child { font: 12px var(--av-mono); color: var(--av-text); font-variant-numeric: tabular-nums; }
.av-check { display: flex; align-items: center; gap: 8px; color: var(--av-text); cursor: pointer; }
.av-check input { accent-color: var(--av-gold); width: 14px; height: 14px; margin: 0; }
.av-check kbd { margin-left: auto; font: 10px var(--av-mono); color: var(--av-faint); }
.av-toggles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; margin-top: 10px; }

.av-icon {
  width: 32px; height: 32px; display: grid; place-items: center; flex: none; border-radius: 7px;
  background: transparent; border: 1px solid transparent; color: var(--av-text); cursor: pointer;
}
.av-icon:hover { border-color: var(--av-line); background: rgba(255, 236, 190, 0.05); }
.av-icon[aria-pressed="true"] { color: var(--av-gold); background: var(--av-fill); border-color: var(--av-line-hi); }
.av-icon:disabled { opacity: 0.35; cursor: default; }
.av-icon.av-primary { color: var(--av-gold); border-color: var(--av-line-hi); }
.av-clip { min-width: 96px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--av-gold); font: 13px var(--av-display); letter-spacing: 0.06em; }
.av-frames { font: 12px var(--av-mono); color: var(--av-dim); font-variant-numeric: tabular-nums; min-width: 82px; text-align: right; }
.av-range { flex: 1; min-width: 60px; -webkit-appearance: none; appearance: none; height: 22px; background: transparent; cursor: pointer; }
.av-range::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: linear-gradient(to right, var(--av-gold) var(--p, 0%), rgba(255, 236, 190, 0.12) var(--p, 0%)); }
.av-range::-moz-range-track { height: 4px; border-radius: 2px; background: rgba(255, 236, 190, 0.12); }
.av-range::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--av-gold); }
.av-range::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; margin-top: -4px; border-radius: 50%; background: ${PARCHMENT}; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.6); }
.av-range::-moz-range-thumb { width: 12px; height: 12px; border: 0; border-radius: 50%; background: ${PARCHMENT}; }
.av-range:focus-visible { outline: 1px solid var(--av-gold); outline-offset: 2px; }
.av-range:disabled { opacity: 0.35; cursor: default; }
.av-sep { width: 1px; align-self: stretch; margin: 12px 2px; background: var(--av-line); }

.av :focus-visible { outline: 1px solid var(--av-gold); outline-offset: 2px; }
.av-loading { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 1; color: var(--av-faint); font: 13px var(--av-display); letter-spacing: 0.12em; }
@media (prefers-reduced-motion: reduce) { .av-panel { transition: none; } }
`;
