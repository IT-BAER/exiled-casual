/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Content hash of public/audio, set by vite.config.ts; absent in tests. */
  readonly VITE_AUDIO_VERSION?: string;
}
