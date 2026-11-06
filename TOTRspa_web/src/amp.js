// DejaVuAmp in the app: the web portal's own player rack (equalizer, balance, mono, clip guard,
// spectrum), imported from vendor/js, a copy of ../DejaVuAmp/js kept in step by tools/sync-
// vendor.cjs. The rack is built the first time someone opens it (inside their tap, which the
// browser requires before audio can be routed through Web Audio) and then kept for the whole
// session, because an <audio> element can be wired into an audio graph only once. Until it is
// opened, playback is a plain <audio> element, which is also what keeps music going with the screen
// off.
import '../vendor/js/dejavuamp-core.js';
import '../vendor/js/settings-carryover.js';
import '../vendor/js/dejavuamp.js';
import '../vendor/js/dejavuamp.css';

let inst = null;
// The page that shows the rack points these at the player; the rack calls them from its buttons.
export const handlers = { prev() {}, next() {}, toggle() {} };

export function openAmp(audio, username) {
  if (!inst) {
    const el = document.createElement('div');
    let storage = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    const rack = window.DejaVuAmp.create({
      audio,
      mount: el,
      username,
      storage,
      calls: {
        onPrev: () => handlers.prev(),
        onNext: () => handlers.next(),
        onToggle: () => handlers.toggle(),
        isPlaying: () => !audio.paused,
      },
    });
    if (storage) window.SettingsCarryOver.run(storage, [window.DejaVuAmpCore.storageKey(username)]);
    rack.load(username);
    inst = { el, rack };
  }
  inst.rack.ensureGraph();
  return inst;
}
export const ampInstance = () => inst;
