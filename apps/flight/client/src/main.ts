// Self-hosted Inter (upstream loaded it from Google Fonts): weights the UI uses.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import { Game } from "./game/Game";
import { ProgressionManager } from "./game/ProgressionManager";

// BodyArcade: upstream's Vercel Web Analytics removed — no analytics, no
// telemetry, no network beacons (BodyArcade non-negotiable).

// BodyArcade: embedded under the tracker page, the game's fullscreen asks
// (lobby GO, HUD button) go to the parent, which fullscreens the game AND the
// player's model view together. Fullscreening this frame alone would cover it.
if (window.parent !== window) {
  const relay = function (this: Element): Promise<void> {
    window.parent.postMessage({ t: "bodyarcade.fullscreen" }, window.location.origin);
    return Promise.resolve();
  };
  Element.prototype.requestFullscreen = relay;
  (Element.prototype as Element & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen = relay;
}

if (import.meta.env.DEV) {
  const params = new URLSearchParams(window.location.search);
  if (params.has("clearSave")) {
    ProgressionManager.clearAll();
    params.delete("clearSave");
    const q = params.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`,
    );
  }
}

const app = document.getElementById("app")!;
const game = new Game(app);
game.start();

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    game.dispose();
    app.innerHTML = "";
  });
}
