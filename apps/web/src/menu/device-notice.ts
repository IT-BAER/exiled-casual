/**
 * Why this device cannot play well, said on the main menu instead of failing
 * silently in the game. Telemetry saw phones stop at the create screen and a
 * SwiftShader desktop sit on the menu; nothing told either of them why.
 *
 * It informs and never blocks: a phone with a Bluetooth mouse plays fine, and
 * no media query can see a keyboard.
 */
import { SOFTWARE_RENDERER } from "../gpu";

export interface DeviceProbe {
  /** The WebGL renderer string, "" when unknown. */
  renderer: string;
  /** Any input that can hover and aim: a mouse or a trackpad. */
  finePointer: boolean;
}

export interface DeviceNotice {
  id: "touch" | "software";
  text: string;
}

export function deviceNotices(probe: DeviceProbe): DeviceNotice[] {
  const notices: DeviceNotice[] = [];
  if (!probe.finePointer) {
    notices.push({ id: "touch", text: "Exiled Casual needs a keyboard and mouse. Touch screens are not supported." });
  }
  if (SOFTWARE_RENDERER.test(probe.renderer)) {
    notices.push({
      id: "software",
      text: "Hardware acceleration is off, so the browser draws the game without the graphics card and it will run very slowly. Turn it on in the browser's settings and restart the browser.",
    });
  }
  return notices;
}

/** `any-pointer`, not `pointer`: a touch laptop's primary pointer is the screen. */
export function probeDevice(renderer: string): DeviceProbe {
  const mq = typeof matchMedia === "function" ? matchMedia : null;
  return { renderer, finePointer: mq ? mq("(any-pointer: fine)").matches : true };
}
