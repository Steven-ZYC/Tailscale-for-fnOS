"use strict";

const elements = Object.fromEntries([
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
].map((id) => [id, document.getElementById(id)]));

const APPEARANCE_KEY = "tailscale-fnos-appearance-v1";
const validPages = new Set(["overview", "devices", "settings"]);

const appState = {
  status: null,
  devices: [],
  refreshing: false,
  latencyMeasured: false,
  statusTimer: null,
  loginTimer: null,
  currentPage: "overview",
  deviceFilter: "all",
  devicePage: 1,
  devicePageSize: 8,
  appearance: { fontScale: 100, uiZoom: 100 }
};

async function request(path, options = {}) {
  const response = await fetch(`./api/${path}`, {
    cache: "no-store",
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`服务返回了无法识别的响应（HTTP ${response.status}）`);
  }
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error?.message || `请求失败（HTTP ${response.status}）`);
  }
  return payload.data;
}

function post(path, value = {}) {
  return request(path, { method: "POST", body: JSON.stringify(value) });
}

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? label : button.dataset.label;
}

function toast(message, type = "") {
  const item = document.createElement("div");
  item.className = `toast ${type}`.trim();
  item.textContent = message;
  elements.toastRegion.appendChild(item);
  window.setTimeout(() => item.remove(), 4200);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

function backendLabel(state) {
  return ({
    Running: "已安全连接",
    Stopped: "连接已暂停",
    NeedsLogin: "等待登录",
    NeedsMachineAuth: "等待管理员批准",
    Starting: "正在建立连接",
    NoState: "尚未配置"
  })[state] || state || "服务不可用";
}

function navigate(page, updateHash = true) {
  const target = validPages.has(page) ? page : "overview";
  appState.currentPage = target;
  document.querySelectorAll("[data-page-panel]").forEach((panel) => {
    const active = panel.dataset.pagePanel === target;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  document.querySelectorAll("[data-page]").forEach((button) => {
    const active = button.dataset.page === target;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (updateHash && window.location.hash !== `#${target}`) {
    window.history.replaceState(null, "", `#${target}`);
  }
  if (target === "devices") renderDevices();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function osDescriptor(device) {
  if (device.self) return { kind: "fnos", label: "fnOS" };
  const os = String(device.os || "").toLowerCase();
  if (os.includes("windows")) return { kind: "windows", label: "Windows" };
  if (os.includes("mac") || os.includes("darwin")) return { kind: "macos", label: "macOS" };
  if (os.includes("ios") || os.includes("iphone") || os.includes("ipad")) return { kind: "ios", label: "iOS / iPadOS" };
  if (os.includes("android")) return { kind: "android", label: "Android" };
  if (os.includes("freebsd") || os.includes("openbsd") || os.includes("netbsd")) return { kind: "bsd", label: "BSD" };
  if (os.includes("linux")) return { kind: "linux", label: "Linux" };
  return { kind: "other", label: device.os || "未知系统" };
}

function osIcon(kind) {
  const icons = {
    fnos: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="6" y="6" width="20" height="8" rx="2"/><rect x="6" y="18" width="20" height="8" rx="2"/><path d="M10 10h.01M10 22h.01M14 10h8M14 22h8"/></svg>',
    windows: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 7.5 14 6v9H5V7.5Zm12-2 10-1.5v11H17V5.5ZM5 18h9v9l-9-1.5V18Zm12 0h10v11l-10-1.5V18Z"/></svg>',
    macos: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="6" width="22" height="16" rx="3"/><path d="M12 27h8m-4-5v5M9 10h14"/></svg>',
    ios: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="9" y="4" width="14" height="24" rx="3"/><path d="M14 7h4M15 24h2"/></svg>',
    android: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m11 8-2-3m12 3 2-3M8 14h16v10a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V14Zm2 0a6 6 0 0 1 12 0M12 11h.01M20 11h.01M5 15v8m22-8v8"/></svg>',
    linux: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="6" width="24" height="20" rx="3"/><path d="m9 12 4 4-4 4m7 0h7"/></svg>',
    bsd: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4 26 8v7c0 6-4.2 10.5-10 13-5.8-2.5-10-7-10-13V8l10-4Z"/><path d="m11 15 3 3 7-7"/></svg>',
    other: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="8" r="4"/><circle cx="8" cy="23" r="4"/><circle cx="24" cy="23" r="4"/><path d="m14 11-4 8m8-8 4 8m-10 4h8"/></svg>'
  };
  return icons[kind] || icons.other;
}

function connectionDescriptor(device) {
  const kind = ["direct", "relay", "offline", "idle"].includes(device.connection)
    ? device.connection
    : "idle";
  const label = kind === "direct"
    ? "直连"
    : kind === "relay"
      ? `DERP ${device.relay || ""}`.trim()
      : kind === "offline" ? "离线" : "空闲";
  return { kind, label };
}

function deviceCard(device, compact = false) {
  const system = osDescriptor(device);
  const connection = connectionDescriptor(device);
  const address = device.ips?.[0] || "—";
  return `<article class="device-card ${compact ? "compact-card" : ""}">
    <div class="os-icon ${system.kind}">${osIcon(system.kind)}</div>
    <div class="device-card-copy">
      <div class="device-card-heading">
        <strong>${escapeHTML(device.name || "未命名设备")}</strong>
        ${device.self ? '<span class="self-tag">本机</span>' : ""}
      </div>
      <p>${escapeHTML(system.label)}${device.exit_node_option ? " · Exit Node" : ""}</p>
      <div class="device-card-details">
        <span class="mono">${escapeHTML(address)}</span>
        <span class="connection-badge ${connection.kind}">${escapeHTML(connection.label)}</span>
      </div>
    </div>
    <span class="device-online-indicator ${device.online ? "online" : ""}" title="${device.online ? "在线" : "离线"}"><span></span>${device.online ? "在线" : "离线"}</span>
  </article>`;
}

function filteredDevices() {
  const query = elements.deviceSearch.value.trim().toLowerCase();
  return appState.devices.filter((device) => {
    const haystack = [device.name, device.dns_name, device.os, ...(device.ips || [])].join(" ").toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const matchesFilter = appState.deviceFilter !== "online" || device.online;
    return matchesQuery && matchesFilter;
  });
}

function renderDevices() {
  const preview = appState.devices.slice(0, 4);
  elements.overviewDeviceCards.innerHTML = preview.length
    ? preview.map((device) => deviceCard(device, true)).join("")
    : '<div class="empty-state">暂无可显示的设备</div>';

  const devices = filteredDevices();
  const totalPages = Math.max(1, Math.ceil(devices.length / appState.devicePageSize));
  appState.devicePage = Math.min(Math.max(1, appState.devicePage), totalPages);
  const start = (appState.devicePage - 1) * appState.devicePageSize;
  const pageDevices = devices.slice(start, start + appState.devicePageSize);
  elements.deviceCards.innerHTML = pageDevices.length
    ? pageDevices.map((device) => deviceCard(device)).join("")
    : `<div class="empty-state">${elements.deviceSearch.value.trim() || appState.deviceFilter === "online" ? "没有匹配的设备" : "暂无可显示的设备"}</div>`;
  elements.devicePageLabel.textContent = `第 ${appState.devicePage} / ${totalPages} 页 · 共 ${devices.length} 台`;
  elements.devicePrev.disabled = appState.devicePage <= 1;
  elements.deviceNext.disabled = appState.devicePage >= totalPages;
  elements.devicePagination.classList.toggle("single-page", totalPages <= 1);
}

function renderStatus(status) {
  appState.status = status;
  appState.devices = status.devices || [];
  elements.packageVersion.textContent = status.package_version || "fnos.0.2";
  elements.versionValue.textContent = status.package_version || "—";
  elements.backendState.textContent = backendLabel(status.backend_state);
  elements.statusDot.className = `status-dot ${status.connected ? "connected" : status.logged_in ? "warning" : "error"}`;
  elements.powerButton.disabled = false;
  elements.powerButton.classList.toggle("connected", status.connected);
  elements.powerLabel.textContent = status.connected ? "断开连接" : status.logged_in ? "重新连接" : "登录连接";
  elements.connectionDescription.textContent = status.connected
    ? "本机流量已接入加密的 Tailscale 网络，设备状态会自动刷新。"
    : status.logged_in
      ? "设备身份仍然保留，点击电源按钮即可重新接入 Tailnet。"
      : status.backend_state === "NeedsMachineAuth"
        ? "设备已经登录，但仍需要 Tailnet 管理员批准。"
        : "使用浏览器或 Auth Key 登录后即可接入你的 Tailnet。";

  const self = status.self;
  const primaryIP = status.tailscale_ips?.[0] || self?.ips?.[0] || "—";
  elements.identityRow.hidden = !self;
  elements.selfName.textContent = self?.name || "—";
  elements.tailnetName.textContent = status.tailnet || "Tailnet";
  elements.onlineCount.textContent = status.online_count ?? 0;
  elements.totalCount.textContent = ` / ${status.total_count ?? 0}`;
  elements.devicePageOnline.textContent = status.online_count ?? 0;
  elements.tailscaleIP.textContent = primaryIP;
  if (document.activeElement !== elements.hostnameInput) elements.hostnameInput.value = self?.name || "";
  elements.hostnameInput.disabled = !status.logged_in;
  elements.hostnameForm.querySelector("button").disabled = !status.logged_in;
  elements.exitNodeToggle.checked = Boolean(status.exit_node_advertised);
  elements.exitNodeToggle.disabled = !status.logged_in;
  elements.exitNodeNote.textContent = status.exit_node_advertised
    ? "正在广播 Exit Node。首次启用后仍需在 Tailscale 管理后台批准。"
    : "启用后会打开运行时 IP 转发，并需要在 Tailscale 管理后台批准此设备。";
  elements.accountDeviceName.textContent = self?.name || "尚未登录";
  elements.accountTailnet.textContent = status.tailnet || "—";
  elements.accountIP.textContent = primaryIP;
  elements.logoutButton.disabled = !status.logged_in;
  renderDevices();

  if (status.logged_in && elements.loginDialog.open) {
    stopLoginPolling();
    elements.loginDialog.close();
    toast(status.connected ? "登录成功，Tailscale 已连接" : "登录成功，正在等待网络就绪", "success");
  }

  if (status.connected && !appState.latencyMeasured) {
    appState.latencyMeasured = true;
    measureLatency(false);
  }
}

function renderUnavailable(message) {
  appState.status = null;
  appState.devices = [];
  elements.backendState.textContent = "本机服务不可用";
  elements.statusDot.className = "status-dot error";
  elements.connectionDescription.textContent = message;
  elements.powerButton.disabled = true;
  elements.powerButton.classList.remove("connected");
  elements.powerLabel.textContent = "不可用";
  elements.onlineCount.textContent = "—";
  elements.totalCount.textContent = " / —";
  elements.devicePageOnline.textContent = "—";
  elements.tailscaleIP.textContent = "—";
  elements.hostnameInput.disabled = true;
  elements.hostnameForm.querySelector("button").disabled = true;
  elements.exitNodeToggle.disabled = true;
  elements.logoutButton.disabled = true;
  elements.accountDeviceName.textContent = "—";
  elements.accountTailnet.textContent = "—";
  elements.accountIP.textContent = "—";
  renderDevices();
}

async function loadStatus(showError = false) {
  if (appState.refreshing) return;
  appState.refreshing = true;
  elements.refreshButton.classList.add("loading");
  try {
    renderStatus(await request("status"));
  } catch (error) {
    renderUnavailable(error.message);
    if (showError) toast(error.message, "error");
  } finally {
    appState.refreshing = false;
    elements.refreshButton.classList.remove("loading");
  }
}

async function toggleConnection() {
  const status = appState.status;
  if (!status) return;
  if (!status.logged_in) {
    elements.loginDialog.showModal();
    return;
  }
  if (status.connected && !window.confirm("确认断开当前设备的 Tailscale 连接？设备身份和设置会保留。")) return;
  elements.powerButton.disabled = true;
  elements.powerLabel.textContent = status.connected ? "正在断开" : "正在连接";
  try {
    const result = await post(status.connected ? "down" : "connect");
    if (result.auth_url) showAuthLink(result.auth_url);
    toast(status.connected ? "Tailscale 已断开" : "Tailscale 已连接", "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    await loadStatus();
  }
}

async function logout() {
  if (!appState.status?.logged_in) return;
  const confirmed = window.confirm("确认退出当前 Tailscale 账户？本机将从 Tailnet 注销，需要重新登录才能连接；FPK 应用不会被卸载。");
  if (!confirmed) return;
  setBusy(elements.logoutButton, true, "正在退出…");
  try {
    await post("logout");
    toast("已退出 Tailscale 账户", "success");
    navigate("overview");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(elements.logoutButton, false);
    await loadStatus();
  }
}

function selectLoginTab(mode) {
  const browser = mode === "browser";
  elements.browserTab.classList.toggle("active", browser);
  elements.keyTab.classList.toggle("active", !browser);
  elements.browserTab.setAttribute("aria-selected", String(browser));
  elements.keyTab.setAttribute("aria-selected", String(!browser));
  elements.browserPane.classList.toggle("active", browser);
  elements.keyPane.classList.toggle("active", !browser);
  elements.browserPane.hidden = !browser;
  elements.keyPane.hidden = browser;
}

function showAuthLink(url) {
  if (!url) return;
  elements.authLink.href = url;
  elements.authLink.hidden = false;
}

function stopLoginPolling() {
  if (!appState.loginTimer) return;
  window.clearInterval(appState.loginTimer);
  appState.loginTimer = null;
}

function startLoginPolling() {
  stopLoginPolling();
  const deadline = Date.now() + 5 * 60 * 1000;
  appState.loginTimer = window.setInterval(async () => {
    if (!elements.loginDialog.open || Date.now() >= deadline) {
      stopLoginPolling();
      return;
    }
    await loadStatus(false);
  }, 2000);
}

async function browserLogin() {
  elements.authLink.hidden = true;
  elements.authLink.removeAttribute("href");
  const authWindow = window.open("about:blank", "_blank");
  if (authWindow) {
    try {
      authWindow.opener = null;
    } catch {
      // The authorization window may already be isolated by the browser.
    }
  }
  setBusy(elements.browserLoginButton, true, "正在获取授权链接…");
  try {
    const result = await post("login/browser");
    if (result.auth_url) {
      let opened = false;
      if (authWindow && !authWindow.closed) {
        try {
          authWindow.location.replace(result.auth_url);
          opened = true;
        } catch {
          authWindow.close();
        }
      }
      if (opened) {
        toast("已打开 Tailscale 授权页面，登录完成后本窗口会自动更新", "success");
      } else {
        showAuthLink(result.auth_url);
        toast("浏览器阻止了新窗口，请点击备用授权链接", "error");
      }
      startLoginPolling();
    } else {
      if (authWindow && !authWindow.closed) authWindow.close();
      toast("设备已经登录并连接", "success");
      elements.loginDialog.close();
    }
  } catch (error) {
    if (authWindow && !authWindow.closed) authWindow.close();
    toast(error.message, "error");
  } finally {
    setBusy(elements.browserLoginButton, false);
    await loadStatus();
  }
}

async function authKeyLogin() {
  const authKey = elements.authKeyInput.value.trim();
  if (!authKey) {
    toast("请输入 Auth Key", "error");
    return;
  }
  setBusy(elements.keyLoginButton, true, "正在登录…");
  try {
    await post("login/auth-key", { auth_key: authKey });
    elements.authKeyInput.value = "";
    elements.loginDialog.close();
    toast("已经通过 Auth Key 登录", "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(elements.keyLoginButton, false);
    await loadStatus();
  }
}

async function saveHostname(event) {
  event.preventDefault();
  const hostname = elements.hostnameInput.value.trim();
  const button = elements.hostnameForm.querySelector("button");
  setBusy(button, true, "保存中");
  try {
    await post("hostname", { hostname });
    toast("设备名称已更新", "success");
    await loadStatus();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function toggleExitNode() {
  const enabled = elements.exitNodeToggle.checked;
  if (enabled && !window.confirm("启用后，Tailnet 中获准的设备可以通过这台 fnOS 访问互联网。确认继续？")) {
    elements.exitNodeToggle.checked = false;
    return;
  }
  elements.exitNodeToggle.disabled = true;
  try {
    const result = await post("exit-node", { enabled });
    toast(enabled ? "已广播本机为 Exit Node" : "已停止广播 Exit Node", "success");
    if (result.warnings?.length) toast(result.warnings.join("；"));
  } catch (error) {
    elements.exitNodeToggle.checked = !enabled;
    toast(error.message, "error");
  } finally {
    await loadStatus();
  }
}

async function measureLatency(showError = true) {
  elements.latencyButton.disabled = true;
  elements.latencyButton.textContent = "检测中";
  elements.latencyValue.textContent = "…";
  elements.latencyUnit.textContent = "";
  try {
    const result = await request("latency");
    elements.latencyValue.textContent = result.nearest_ms ? Number(result.nearest_ms).toFixed(1) : "—";
    elements.latencyUnit.textContent = result.nearest_ms ? " ms" : "";
    elements.latencyButton.title = result.preferred_derp ? `首选 DERP #${result.preferred_derp}` : "未找到可用 DERP";
  } catch (error) {
    elements.latencyValue.textContent = "—";
    if (showError) toast(error.message, "error");
  } finally {
    elements.latencyButton.disabled = false;
    elements.latencyButton.textContent = "重测";
  }
}

async function checkUpdate(showError = true) {
  setBusy(elements.updateButton, true, "正在检查…");
  elements.updateState.className = "update-state";
  elements.updateState.textContent = "检查中";
  try {
    const result = await request("update");
    if (result.release_url) elements.releaseLink.href = result.release_url;
    if (!result.published) {
      elements.updateState.textContent = "暂无发布";
      elements.updateDescription.textContent = "GitHub 尚无公开 Release，当前为测试构建";
    } else if (result.available) {
      elements.updateState.classList.add("available");
      elements.updateState.textContent = "可更新";
      elements.updateDescription.textContent = `发现 ${result.latest}，请前往 GitHub 下载 FPK`;
      toast(`发现新版本 ${result.latest}`, "success");
    } else {
      elements.updateState.classList.add("current");
      elements.updateState.textContent = "已是最新";
      elements.updateDescription.textContent = `当前 ${result.current}，没有发现更高版本`;
    }
  } catch (error) {
    elements.updateState.textContent = "检测失败";
    elements.updateDescription.textContent = "无法连接 GitHub，可稍后重试";
    if (showError) toast(error.message, "error");
  } finally {
    setBusy(elements.updateButton, false);
  }
}

function applyAppearance(save = true) {
  const fontScale = clamp(appState.appearance.fontScale, 90, 120, 100);
  const uiZoom = clamp(appState.appearance.uiZoom, 80, 120, 100);
  appState.appearance = { fontScale, uiZoom };
  document.documentElement.style.setProperty("--font-delta", `${(fontScale - 100) / 5}px`);
  document.documentElement.style.setProperty("--ui-zoom", String(uiZoom / 100));
  elements.fontScaleInput.value = String(fontScale);
  elements.fontScaleValue.textContent = `${fontScale}%`;
  elements.uiZoomInput.value = String(uiZoom);
  elements.uiZoomValue.textContent = `${uiZoom}%`;
  if (save) window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appState.appearance));
}

function loadAppearance() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(APPEARANCE_KEY) || "null");
    if (stored) appState.appearance = stored;
  } catch {
    window.localStorage.removeItem(APPEARANCE_KEY);
  }
  applyAppearance(false);
}

function resetAppearance() {
  appState.appearance = { fontScale: 100, uiZoom: 100 };
  applyAppearance(true);
  toast("显示设置已恢复默认", "success");
}

document.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.page)));
document.querySelectorAll("[data-device-filter]").forEach((button) => button.addEventListener("click", () => {
  appState.deviceFilter = button.dataset.deviceFilter;
  appState.devicePage = 1;
  document.querySelectorAll("[data-device-filter]").forEach((item) => item.classList.toggle("active", item === button));
  renderDevices();
}));
elements.refreshButton.addEventListener("click", () => loadStatus(true));
elements.powerButton.addEventListener("click", toggleConnection);
elements.viewAllDevices.addEventListener("click", () => navigate("devices"));
elements.deviceSearch.addEventListener("input", () => { appState.devicePage = 1; renderDevices(); });
elements.devicePrev.addEventListener("click", () => { appState.devicePage -= 1; renderDevices(); });
elements.deviceNext.addEventListener("click", () => { appState.devicePage += 1; renderDevices(); });
elements.hostnameForm.addEventListener("submit", saveHostname);
elements.exitNodeToggle.addEventListener("change", toggleExitNode);
elements.logoutButton.addEventListener("click", logout);
elements.latencyButton.addEventListener("click", () => measureLatency(true));
elements.updateButton.addEventListener("click", () => checkUpdate(true));
elements.browserTab.addEventListener("click", () => selectLoginTab("browser"));
elements.keyTab.addEventListener("click", () => selectLoginTab("key"));
elements.browserLoginButton.addEventListener("click", browserLogin);
elements.keyLoginButton.addEventListener("click", authKeyLogin);
elements.fontScaleInput.addEventListener("input", () => { appState.appearance.fontScale = Number(elements.fontScaleInput.value); applyAppearance(true); });
elements.uiZoomInput.addEventListener("input", () => { appState.appearance.uiZoom = Number(elements.uiZoomInput.value); applyAppearance(true); });
elements.appearanceResetButton.addEventListener("click", resetAppearance);
elements.loginDialog.addEventListener("close", () => {
  stopLoginPolling();
  elements.authKeyInput.value = "";
  elements.authLink.hidden = true;
  elements.authLink.removeAttribute("href");
});
window.addEventListener("hashchange", () => navigate(window.location.hash.slice(1), false));

loadAppearance();
navigate(window.location.hash.slice(1), false);
loadStatus();
checkUpdate(false);
appState.statusTimer = window.setInterval(() => loadStatus(false), 10000);
