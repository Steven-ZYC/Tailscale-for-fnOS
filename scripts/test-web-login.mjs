#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const indexSource = await readFile(new URL("../internal/manager/web/index.html", import.meta.url), "utf8");

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.textContent = "";
    this.innerHTML = "";
    this.value = "";
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.open = false;
    this.href = "";
    this.title = "";
    this.className = "";
    this.tabIndex = 0;
    this.dataset = {};
    this.classList = new FakeClassList();
    this.attributes = new Map();
    this.listeners = new Map();
    this.children = [];
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  async emit(type, event = {}) {
    const listener = this.listeners.get(type);
    if (listener) return listener({ preventDefault() {}, ...event });
    return undefined;
  }

  focus() {
    document.activeElement = this;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "tabindex") this.tabIndex = Number(value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "href") this.href = "";
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  remove() {
    this.removed = true;
  }

  querySelector(selector) {
    if (selector !== "button") return null;
    if (!this.button) this.button = new FakeElement(`${this.id}-button`);
    return this.button;
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
    const listener = this.listeners.get("close");
    if (listener) listener();
  }
}

const elementIDs = [...indexSource.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const elements = new Map(elementIDs.map((id) => [id, new FakeElement(id)]));

function elementsWithDataAttribute(attribute, datasetKey) {
  return [...indexSource.matchAll(new RegExp(`<[^>]+\\b${attribute}="([^"]+)"[^>]*>`, "g"))].map((match) => {
    const tag = match[0];
    const element = elements.get(tag.match(/\bid="([^"]+)"/)[1]);
    element.dataset[datasetKey] = match[1];
    for (const [, name, value] of tag.matchAll(/([\w-]+)="([^"]*)"/g)) element.setAttribute(name, value);
    element.hidden = /\s+hidden(?:\s|>)/.test(tag);
    const classes = tag.match(/\bclass="([^"]*)"/)?.[1] || "";
    element.classList.add(...classes.split(/\s+/).filter(Boolean));
    return element;
  });
}

const settingsTabElements = elementsWithDataAttribute("data-settings-tab", "settingsTab");
const settingsPanelElements = elementsWithDataAttribute("data-settings-panel", "settingsPanel");
elements.get("browserLoginButton").textContent = "登录并打开授权页面";
elements.get("authLink").hidden = true;
elements.get("fontScaleInput").value = "100";
elements.get("uiZoomInput").value = "100";

const intervals = new Map();
const styleValues = new Map();
let intervalSequence = 0;
let loggedIn = false;
let popupBlocked = false;
let exitAdvertised = false;
let exitFailure = false;
const exitRequests = [];
const openedURLs = [];

const document = {
  activeElement: null,
  documentElement: { style: { setProperty(name, value) { styleValues.set(name, value); } } },
  getElementById(id) {
    return elements.get(id) || null;
  },
  querySelectorAll(selector) {
    if (selector === "[data-settings-tab]") return settingsTabElements;
    if (selector === "[data-settings-panel]") return settingsPanelElements;
    return [];
  },
  createElement() {
    return new FakeElement();
  }
};

const localStorageValues = new Map([
  ["tailscale-fnos-appearance-v1", JSON.stringify({ fontScale: 120, uiZoom: 80 })]
]);
const windowObject = {
  document,
  location: { hash: "" },
  history: { replaceState(_state, _title, hash) { windowObject.location.hash = hash; } },
  localStorage: {
    getItem(key) { return localStorageValues.get(key) || null; },
    setItem(key, value) { localStorageValues.set(key, String(value)); },
    removeItem(key) { localStorageValues.delete(key); }
  },
  confirm() { return true; },
  scrollTo() {},
  addEventListener() {},
  setTimeout() { return 0; },
  setInterval(callback, delay) {
    const id = ++intervalSequence;
    intervals.set(id, { callback, delay });
    return id;
  },
  clearInterval(id) {
    intervals.delete(id);
  },
  open() {
    if (popupBlocked) return null;
    const popup = {
      closed: false,
      opener: windowObject,
      location: { replace(url) { openedURLs.push(url); } },
      close() { this.closed = true; }
    };
    return popup;
  }
};

async function fakeFetch(url, options = {}) {
  const path = String(url);
  let data = {};
  if (path.includes("api/status")) {
    data = loggedIn
      ? {
          backend_state: "Running", connected: true, logged_in: true,
          tailscale_ips: ["100.64.0.2"],
          self: { name: "fnos-test", os: "linux", ips: ["100.64.0.2"], online: true, self: true },
          devices: [], online_count: 1, total_count: 1,
          exit_node_advertised: exitAdvertised, exit_node_enabled: exitAdvertised,
          exit_node_state_known: true, exit_node_approval: "unknown",
          ipv4_forwarding: exitAdvertised, ipv6_forwarding: exitAdvertised,
          ipv6_forwarding_available: true,
          package_version: "1.104.2-fnos.0.8.1", tailscale_version: "1.104.2"
        }
      : {
          backend_state: "NeedsLogin", connected: false, logged_in: false,
          tailscale_ips: [], devices: [], online_count: 0, total_count: 0,
          package_version: "1.104.2-fnos.0.8.1", tailscale_version: "1.104.2"
        };
  } else if (path.includes("api/login/browser")) {
    data = { auth_url: "https://login.tailscale.com/a/mock-test" };
  } else if (path.includes("api/update")) {
    data = { current: "1.104.2-fnos.0.8.1", published: false };
  } else if (path.includes("api/latency")) {
    data = { nearest_ms: 12, preferred_derp: 1 };
  } else if (path.includes("api/exit-node")) {
    const input = JSON.parse(options.body);
    exitRequests.push(input.enabled);
    if (exitFailure) {
      return { ok: false, status: 502, async json() {
        return { ok: false, error: { code: "exit_node_failed", message: "无法启用主机转发，已回滚" } };
      } };
    }
    exitAdvertised = input.enabled;
    data = { enabled: exitAdvertised, warnings: [] };
  }
  return { ok: true, status: 200, async json() { return { ok: true, data }; } };
}

const context = vm.createContext({
  console,
  document,
  window: windowObject,
  fetch: fakeFetch
});

assert.match(indexSource, /id="fontScaleInput"[^>]+min="70"[^>]+max="160"/);
assert.match(indexSource, /id="uiZoomInput"[^>]+min="50"[^>]+max="160"/);
assert.match(indexSource, /id="fontScaleValue"[^>]+type="number"[^>]+min="70"[^>]+max="160"/);
assert.match(indexSource, /id="uiZoomValue"[^>]+type="number"[^>]+min="50"[^>]+max="160"/);
assert.match(indexSource, /<footer>fnOS原生应用 · 使用官方 Tailscale 二进制<\/footer>/);

const source = await readFile(new URL("../internal/manager/web/app.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "app.js" });

const flush = () => new Promise((resolve) => setImmediate(resolve));
await flush();
await flush();

assert.equal(elements.get("versionValue").textContent, "v0.8.1", "overview should show the community revision prominently");
assert.equal(elements.get("versionValue").title, "1.104.2-fnos.0.8.1", "the version tooltip should retain the complete package version");
assert.equal(elements.get("settingsVersion").textContent, "1.104.2-fnos.0.8.1", "settings should retain the complete package version");

function assertSettingsTab(name) {
  for (const tab of settingsTabElements) {
    const selected = tab.dataset.settingsTab === name;
    assert.equal(tab.getAttribute("aria-selected"), String(selected), `${tab.id} selection should reflect ${name}`);
    assert.equal(tab.tabIndex, selected ? 0 : -1, "only the selected settings tab should be in the tab order");
    const panel = settingsPanelElements.find((item) => item.dataset.settingsPanel === tab.dataset.settingsTab);
    assert.ok(panel, `${tab.id} must have a corresponding panel`);
    assert.equal(tab.getAttribute("role"), "tab");
    assert.equal(panel.getAttribute("role"), "tabpanel");
    assert.equal(tab.getAttribute("aria-controls"), panel.id);
    assert.equal(panel.getAttribute("aria-labelledby"), tab.id);
    assert.equal(panel.hidden, !selected, "only the selected settings panel should be visible");
  }
}

assert.equal(settingsTabElements.length, 4, "all four settings categories should be represented");
assertSettingsTab("network");
for (const name of ["appearance", "account", "about", "network"]) {
  await settingsTabElements.find((tab) => tab.dataset.settingsTab === name).emit("click");
  assertSettingsTab(name);
}
for (const [from, key, to] of [
  ["network", "ArrowRight", "appearance"],
  ["appearance", "ArrowLeft", "network"],
  ["network", "ArrowLeft", "about"],
  ["about", "ArrowRight", "network"],
  ["network", "End", "about"],
  ["about", "Home", "network"]
]) {
  let prevented = false;
  await settingsTabElements.find((tab) => tab.dataset.settingsTab === from).emit("keydown", {
    key, preventDefault() { prevented = true; }
  });
  assert.equal(prevented, true, `${key} should prevent page scrolling`);
  assertSettingsTab(to);
  assert.equal(document.activeElement.dataset.settingsTab, to, `${key} should move keyboard focus to the selected tab`);
}
await settingsTabElements[0].emit("keydown", { key: "Enter" });
assertSettingsTab("network");
await settingsTabElements.find((tab) => tab.dataset.settingsTab === "about").emit("click");
await elements.get("overviewSettingsButton").emit("click");
assertSettingsTab("network");
assert.equal(elements.get("breadcrumbTitle").textContent, "设置", "overview settings shortcut should navigate to settings");

assert.equal(elements.get("fontScaleValue").value, "100", "legacy 120% font should migrate to the new 100%");
assert.equal(elements.get("uiZoomValue").value, "100", "legacy 80% zoom should migrate to the new 100%");
assert.equal(styleValues.get("--font-delta"), "4px");
assert.equal(styleValues.get("--ui-zoom"), "0.8");
assert.ok(localStorageValues.has("tailscale-fnos-appearance-v2"), "migrated display settings should use the v2 key");

elements.get("fontScaleInput").value = "160";
await elements.get("fontScaleInput").emit("input");
assert.equal(elements.get("fontScaleValue").value, "160", "font value should preview while dragging");
assert.equal(styleValues.get("--font-delta"), "4px", "font geometry should stay fixed while dragging");
await elements.get("fontScaleInput").emit("change");
assert.equal(styleValues.get("--font-delta"), "16px", "font range should extend above the old maximum");
elements.get("fontScaleValue").value = "125";
await elements.get("fontScaleValue").emit("input");
assert.equal(styleValues.get("--font-delta"), "16px", "typed font value should not apply before commit");
await elements.get("fontScaleValue").emit("change");
assert.equal(elements.get("fontScaleInput").value, "125", "typed font value should synchronize the slider");
assert.equal(styleValues.get("--font-delta"), "9px", "typed font value should apply after commit");
elements.get("uiZoomInput").value = "50";
await elements.get("uiZoomInput").emit("input");
assert.equal(elements.get("uiZoomValue").value, "50", "zoom value should preview while dragging");
assert.equal(styleValues.get("--ui-zoom"), "0.8", "page geometry should stay fixed while dragging");
await elements.get("uiZoomInput").emit("change");
assert.equal(styleValues.get("--ui-zoom"), "0.4", "interface zoom should extend below the old minimum");
elements.get("uiZoomValue").value = "125";
await elements.get("uiZoomValue").emit("input");
assert.equal(styleValues.get("--ui-zoom"), "0.4", "typed zoom value should not apply before commit");
await elements.get("uiZoomValue").emit("change");
assert.equal(elements.get("uiZoomInput").value, "125", "typed zoom value should synchronize the slider");
assert.equal(styleValues.get("--ui-zoom"), "1", "typed zoom value should apply after commit");
await elements.get("appearanceResetButton").emit("click");
assert.equal(elements.get("fontScaleValue").value, "100");
assert.equal(elements.get("uiZoomValue").value, "100");
assert.equal(styleValues.get("--font-delta"), "4px");
assert.equal(styleValues.get("--ui-zoom"), "0.8");

await elements.get("powerButton").emit("click");
assert.equal(elements.get("loginDialog").open, true, "login dialog should open for a logged-out device");

await elements.get("browserLoginButton").emit("click");
assert.deepEqual(openedURLs, ["https://login.tailscale.com/a/mock-test"]);
assert.equal(elements.get("authLink").hidden, true, "fallback link should stay hidden when the new window opens");
assert.equal(elements.get("browserLoginButton").textContent, "登录并打开授权页面");

loggedIn = true;
const loginPoll = [...intervals.values()].find((timer) => timer.delay === 2000);
assert.ok(loginPoll, "browser login should start a two-second status poll");
await loginPoll.callback();
await flush();
assert.equal(elements.get("loginDialog").open, false, "login dialog should close after status reports login success");
assert.equal([...intervals.values()].some((timer) => timer.delay === 2000), false, "login polling should stop after success");

await settingsTabElements.find((tab) => tab.dataset.settingsTab === "account").emit("click");
await elements.get("openExitSettings").emit("click");
assertSettingsTab("network");
assert.equal(elements.get("breadcrumbTitle").textContent, "设置", "Exit Node shortcut should navigate to settings");
assert.equal(document.activeElement, elements.get("exitNodeToggle"), "Exit Node shortcut should focus its switch");

elements.get("exitNodeToggle").checked = true;
await elements.get("exitNodeToggle").emit("change");
assert.deepEqual(exitRequests, [true], "enabling must request the host operation");
assert.equal(elements.get("exitNodeToggle").checked, true, "verified host status should keep the toggle enabled");
assert.equal(elements.get("exitNodeToggle").disabled, false, "toggle should recover after completion");

elements.get("exitNodeToggle").checked = false;
await elements.get("exitNodeToggle").emit("change");
assert.deepEqual(exitRequests, [true, false], "disabling must request local withdrawal");
assert.equal(elements.get("exitNodeToggle").checked, false);

exitFailure = true;
elements.get("exitNodeToggle").checked = true;
await elements.get("exitNodeToggle").emit("change");
assert.equal(elements.get("exitNodeToggle").checked, false, "failed enable should reflect the rolled-back host state");
assert.equal(elements.get("exitNodeToggle").disabled, false);
assert.ok(elements.get("toastRegion").children.some((item) => item.textContent.includes("已回滚")), "host failure should remain visible");
exitFailure = false;

loggedIn = false;
const statusPoll = [...intervals.values()].find((timer) => timer.delay === 10000);
assert.ok(statusPoll, "the regular status poll should remain active");
await statusPoll.callback();
await flush();
await elements.get("powerButton").emit("click");
popupBlocked = true;
await elements.get("browserLoginButton").emit("click");
assert.equal(elements.get("authLink").hidden, false, "a blocked pop-up should reveal the fallback link");
assert.equal(elements.get("authLink").href, "https://login.tailscale.com/a/mock-test");
elements.get("loginDialog").close();

console.log("web UI interaction tests passed");
