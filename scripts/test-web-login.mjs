#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

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
    this.dataset = {};
    this.classList = new FakeClassList();
    this.attributes = new Map();
    this.listeners = new Map();
    this.children = [];
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  async emit(type) {
    const listener = this.listeners.get(type);
    if (listener) return listener({ preventDefault() {} });
    return undefined;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
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

const elementIDs = [
  "packageVersion", "refreshButton", "statusDot", "backendState", "connectionDescription",
  "identityRow", "selfName", "tailnetName", "powerButton", "powerLabel", "onlineCount",
  "totalCount", "latencyValue", "latencyUnit", "latencyButton", "tailscaleIP", "versionValue",
  "updateState", "overviewDeviceCards", "viewAllDevices", "deviceCards", "deviceSearch",
  "devicePagination", "devicePrev", "deviceNext", "devicePageLabel", "devicePageOnline",
  "hostnameForm", "hostnameInput", "exitNodeToggle", "exitNodeNote", "fontScaleInput",
  "fontScaleValue", "uiZoomInput", "uiZoomValue", "appearanceResetButton", "accountDeviceName",
  "accountTailnet", "accountIP", "logoutButton", "updateButton", "updateDescription",
  "releaseLink", "loginDialog", "browserTab", "keyTab", "browserPane", "keyPane",
  "browserLoginButton", "authLink", "authKeyInput", "keyLoginButton", "toastRegion"
];
const elements = new Map(elementIDs.map((id) => [id, new FakeElement(id)]));
elements.get("browserLoginButton").textContent = "登录并打开授权页面";
elements.get("authLink").hidden = true;
elements.get("fontScaleInput").value = "100";
elements.get("uiZoomInput").value = "100";

const intervals = new Map();
const styleValues = new Map();
let intervalSequence = 0;
let loggedIn = false;
let popupBlocked = false;
const openedURLs = [];

const document = {
  activeElement: null,
  documentElement: { style: { setProperty(name, value) { styleValues.set(name, value); } } },
  getElementById(id) {
    return elements.get(id) || null;
  },
  querySelectorAll() {
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

async function fakeFetch(url) {
  const path = String(url);
  let data = {};
  if (path.includes("api/status")) {
    data = loggedIn
      ? {
          backend_state: "Running", connected: true, logged_in: true,
          tailscale_ips: ["100.64.0.2"],
          self: { name: "fnos-test", os: "linux", ips: ["100.64.0.2"], online: true, self: true },
          devices: [], online_count: 1, total_count: 1,
          package_version: "1.102.2-fnos.0.4", tailscale_version: "1.102.2"
        }
      : {
          backend_state: "NeedsLogin", connected: false, logged_in: false,
          tailscale_ips: [], devices: [], online_count: 0, total_count: 0,
          package_version: "1.102.2-fnos.0.4", tailscale_version: "1.102.2"
        };
  } else if (path.includes("api/login/browser")) {
    data = { auth_url: "https://login.tailscale.com/a/mock-test" };
  } else if (path.includes("api/update")) {
    data = { current: "1.102.2-fnos.0.4", published: false };
  } else if (path.includes("api/latency")) {
    data = { nearest_ms: 12, preferred_derp: 1 };
  }
  return { ok: true, status: 200, async json() { return { ok: true, data }; } };
}

const context = vm.createContext({
  console,
  document,
  window: windowObject,
  fetch: fakeFetch
});

const indexSource = await readFile(new URL("../internal/manager/web/index.html", import.meta.url), "utf8");
assert.match(indexSource, /id="fontScaleInput"[^>]+min="70"[^>]+max="160"/);
assert.match(indexSource, /id="uiZoomInput"[^>]+min="50"[^>]+max="160"/);

const source = await readFile(new URL("../internal/manager/web/app.js", import.meta.url), "utf8");
vm.runInContext(source, context, { filename: "app.js" });

const flush = () => new Promise((resolve) => setImmediate(resolve));
await flush();
await flush();

assert.equal(elements.get("fontScaleValue").textContent, "100%", "legacy 120% font should migrate to the new 100%");
assert.equal(elements.get("uiZoomValue").textContent, "100%", "legacy 80% zoom should migrate to the new 100%");
assert.equal(styleValues.get("--font-delta"), "4px");
assert.equal(styleValues.get("--ui-zoom"), "0.8");
assert.ok(localStorageValues.has("tailscale-fnos-appearance-v2"), "migrated display settings should use the v2 key");

elements.get("fontScaleInput").value = "160";
await elements.get("fontScaleInput").emit("input");
assert.equal(styleValues.get("--font-delta"), "16px", "font range should extend above the old maximum");
elements.get("uiZoomInput").value = "50";
await elements.get("uiZoomInput").emit("input");
assert.equal(styleValues.get("--ui-zoom"), "0.4", "interface zoom should extend below the old minimum");
await elements.get("appearanceResetButton").emit("click");
assert.equal(elements.get("fontScaleValue").textContent, "100%");
assert.equal(elements.get("uiZoomValue").textContent, "100%");
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
