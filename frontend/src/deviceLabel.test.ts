import { describe, expect, it } from "vitest";
import { describeDevice } from "./deviceLabel";

/** User-agents réels, abrégés sur les parties qui ne servent pas à l'identification. */
const UA = {
  safariIOS:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  chromeIOS:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  firefoxIOS:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
  edgeIOS:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/126.0.2592.87 Mobile/15E148 Safari/605.1.15",
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.87",
  firefoxWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  samsungAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
};

describe("libellé d'appareil", () => {
  it("distingue les navigateurs tiers sur iOS, qui s'annoncent tous comme Safari", () => {
    // Régression : CriOS/FxiOS/EdgiOS ne contiennent ni « Chrome/ » ni « Firefox/ », donc
    // les trois retombaient sur « Safari sur iOS » — deux appareils différents, même libellé.
    expect(describeDevice(UA.chromeIOS)).toBe("Chrome sur iOS");
    expect(describeDevice(UA.firefoxIOS)).toBe("Firefox sur iOS");
    expect(describeDevice(UA.edgeIOS)).toBe("Edge sur iOS");
    expect(describeDevice(UA.safariIOS)).toBe("Safari sur iOS");
  });

  it("ne confond pas Edge avec Chrome, dont il reprend l'UA", () => {
    expect(describeDevice(UA.edgeWindows)).toBe("Edge sur Windows");
    expect(describeDevice(UA.chromeWindows)).toBe("Chrome sur Windows");
  });

  it("reconnaît les combinaisons courantes de bureau et d'Android", () => {
    expect(describeDevice(UA.firefoxWindows)).toBe("Firefox sur Windows");
    expect(describeDevice(UA.safariMac)).toBe("Safari sur macOS");
    expect(describeDevice(UA.chromeAndroid)).toBe("Chrome sur Android");
    expect(describeDevice(UA.samsungAndroid)).toBe("Samsung Internet sur Android");
    expect(describeDevice(UA.firefoxLinux)).toBe("Firefox sur Linux");
  });

  it("ne prétend rien quand l'user-agent est absent ou inconnu", () => {
    expect(describeDevice(undefined)).toBe("Appareil inconnu");
    expect(describeDevice("")).toBe("Appareil inconnu");
    expect(describeDevice("un-robot-quelconque/1.0")).toBe("Appareil inconnu");
  });

  it("se contente de ce qu'il sait quand une seule moitié est identifiable", () => {
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows");
  });
});
