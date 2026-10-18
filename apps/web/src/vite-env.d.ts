/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Content hash of public/audio, set by vite.config.ts; absent in tests. */
  readonly VITE_AUDIO_VERSION?: string;
  /** `<version>+<commit>`, set by vite.config.ts; absent in tests. */
  readonly VITE_EC_BUILD?: string;
  /** Build time in ms epoch, as a string; set by vite.config.ts. */
  readonly VITE_EC_BUILT_AT?: string;
}
