// FalseHorizon in the app: the portal's preset-driven visualizer (WebGL), imported from vendor/js
// (a copy of ../FalseHorizons/js made by tools/sync-vendor.cjs) like DejaVuAmp. It listens through
// DejaVuAmp's analyser, so turning the visuals on also routes the music through Web Audio (the same
// opt-in as the equalizer). The engine, its controls and its canvas are built the first time
// someone taps "Visuals", kept for the session, and re-attached when the Radio page is opened
// again.
import '../vendor/js/falsehorizon-expr.js';
import '../vendor/js/falsehorizon-presets.js';
import '../vendor/js/falsehorizon-core.js';
import '../vendor/js/falsehorizon-milk.js';
import '../vendor/js/falsehorizon.js';
import '../vendor/js/falsehorizon-scene.js';
import '../vendor/js/falsehorizon-ui.js';
import '../vendor/js/settings-carryover.js';
import '../vendor/js/falsehorizon.css';
import { openAmp } from './amp.js';

let inst = null;
// The Radio page points these at itself; the controls call them when settings change or the preset
// moves.
export const handlers = { change() {}, preset() {} };
const calm = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

export function openFh(audio, username) {
  // inside the tap: builds the audio graph the analyser lives in
  const amp = openAmp(audio, username);
  if (!inst) {
    const canvas = document.createElement('canvas');
    canvas.className = 'fh-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.hidden = true;
    const engine = window.FalseHorizon.create(canvas);
    engine.setCalm(calm());
    const el = document.createElement('div');
    let storage = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    const ui = window.FalseHorizonUI.create({
      engine,
      mount: el,
      username,
      storage,
      calls: {
        onChange: () => handlers.change(),
        onPreset: name => handlers.preset(name),
      },
    });
    // phones: a lower frame rate (the preset maths runs on the main thread and competes with the
    // audio), and a lighter 3D surface the first time
    // touch devices only: the desktop apps keep full speed
    if (window.matchMedia && matchMedia('(pointer: coarse)').matches) engine.setMaxFps(30);
    if (storage)
      window.SettingsCarryOver.run(storage, [window.FalseHorizonCore.storageKey(username)]);
    const had =
      !!storage &&
      (() => {
        try {
          return storage.getItem(window.FalseHorizonCore.storageKey(username)) !== null;
        } catch {
          return true;
        }
      })();
    ui.load(username);
    if (!had) ui.change({ geometry: 25 }, false);
    // the portal also offers the older photo-smear; the app only has the new one
    const style = el.querySelector('select[aria-label="Which visualizer"]');
    if (style && style.closest('label')) style.closest('label').hidden = true;
    if (ui.settings().mode !== 'horizon') ui.change({ mode: 'horizon' });
    inst = { engine, ui, el, canvas, scene: null, sceneBroken: false };
  }
  inst.engine.setAnalyser(amp.rack.analyser());
  return inst;
}
export const fhInstance = () => inst;

// The collage as an ingredient (falsehorizon-scene.js copies its layers into the picture). If
// drawing it fails, the page shows the collage as it was.
export function sceneFor(layersEl, onFail) {
  if (!inst || inst.sceneBroken || !window.FalseHorizonScene) return null;
  if (!inst.scene || inst.sceneHost !== layersEl) {
    inst.scene = window.FalseHorizonScene.create(layersEl, {
      onFail: () => {
        inst.sceneBroken = true;
        onFail();
      },
    });
    inst.sceneHost = layersEl;
  }
  return inst.scene;
}
