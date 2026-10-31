import { beforeEach, describe, expect, it } from "vitest";
import { beginLoad, loadProgress, resetLoadProgress, setDownloaded, setLoadPart, subscribeLoadProgress } from "./load-progress";

describe("load progress", () => {
  beforeEach(() => resetLoadProgress());

  it("weighs a game entry by downloads, models, worker and ready materials", () => {
    beginLoad("entry");
    expect(loadProgress()).toBe(0);
    setDownloaded(0.5);
    expect(loadProgress()).toBe(25);
    setLoadPart("worker", 1);
    expect(loadProgress()).toBe(35);
    // Parsed models mean every byte they needed has arrived, whoever fetched it.
    setLoadPart("models", 1);
    expect(loadProgress()).toBe(75);
    setLoadPart("ready", 0.5);
    expect(loadProgress()).toBe(88);
    setLoadPart("ready", 1);
    expect(loadProgress()).toBe(100);
  });

  it("starts an entry from what the roster already downloaded", () => {
    setDownloaded(1);
    beginLoad("entry");
    expect(loadProgress()).toBe(50);
  });

  it("measures an area change by ready materials alone", () => {
    beginLoad("area");
    setLoadPart("ready", 0.4);
    expect(loadProgress()).toBe(40);
  });

  it("never goes backwards within one load, and starts over with the next", () => {
    beginLoad("area");
    setLoadPart("ready", 0.8);
    // A new mesh joins the scene unready: the share drops, the bar does not.
    setLoadPart("ready", 0.6);
    expect(loadProgress()).toBe(80);
    beginLoad("area");
    expect(loadProgress()).toBe(0);
  });

  it("tells listeners only when the whole percent changes", () => {
    beginLoad("area");
    let calls = 0;
    const stop = subscribeLoadProgress(() => calls++);
    setLoadPart("ready", 0.101);
    setLoadPart("ready", 0.102);
    setLoadPart("ready", 0.2);
    stop();
    setLoadPart("ready", 0.3);
    expect(calls).toBe(2);
  });
});
