// jsdom has no canvas backend, so every getContext call it sees is reported as
// "Not implemented" through the virtual console. Nothing under test needs a real
// 2D or WebGL context (Babylon is mocked, the HUD only measures layout), so give
// them the null a browser also returns for an unsupported context type and keep
// the run readable. Real failures still surface: null is what the callers guard
// against anyway.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = () => null;
}
