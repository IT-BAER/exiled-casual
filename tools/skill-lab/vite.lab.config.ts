// The capture harness's Vite: the app's own config with file watching and HMR off,
// so a worker saving a file mid-capture cannot reload the page under the recorder.
import { mergeConfig } from "vite";
import base from "../../apps/web/vite.config";

export default mergeConfig(base, { server: { hmr: false, watch: { ignored: ["**/*"] } } });
