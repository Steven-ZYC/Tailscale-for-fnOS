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
  "browserLoginButton", "authLink", "authKeyInput", "keyLoginButton", "toastRegion",
  "breadcrumbTitle", "sidebarStatus", "sidebarDeviceName", "copyIPButton", "ipCopyLabel",
  "lastUpdated", "tailscaleVersion", "latencyRegion", "overviewExitStatus",
  "overviewExitDescription", "openExitSettings", "healthPanel", "healthList",
  "exitNodeState", "exitConnectionState", "exitAdvertiseState", "exitIPv4State",
  "exitIPv6State", "exitApprovalState", "settingsVersion", "exitDiagnostics",
  "connectionCard", "overviewSettingsButton"
].map((id) => [id, document.getElementById(id)]));

const APPEARANCE_KEY = "tailscale-fnos-appearance-v2";
const LEGACY_APPEARANCE_KEY = "tailscale-fnos-appearance-v1";
const DEFAULT_APPEARANCE = Object.freeze({ fontScale: 100, uiZoom: 100 });
const validPages = new Set(["overview", "devices", "settings"]);
const settingsTabs = ["network", "appearance", "account", "about"];

const appState = {
  status: null,
  devices: [],
  refreshing: false,
  refreshPromise: null,
  statusEpoch: 0,
  connectionBusy: false,
  exitNodeBusy: false,
  hostnameDirty: false,
  hostnameBusy: false,
  latencyMeasured: false,
  statusTimer: null,
  loginTimer: null,
  currentPage: "overview",
  currentSettingsTab: "network",
  exitNeedsAttention: false,
  deviceFilter: "all",
  devicePage: 1,
  devicePageSize: 8,
  appearance: { ...DEFAULT_APPEARANCE }
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
  elements.breadcrumbTitle.textContent = ({ overview: "概览", devices: "网络设备", settings: "设置" })[target];
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

function selectSettingsTab(name, focus = false) {
  const target = settingsTabs.includes(name) ? name : "network";
  appState.currentSettingsTab = target;
  document.querySelectorAll("[data-settings-tab]").forEach((tab) => {
    const active = tab.dataset.settingsTab === target;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.setAttribute("tabindex", active ? "0" : "-1");
    if (active && focus) tab.focus();
  });
  document.querySelectorAll("[data-settings-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== target;
  });
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
  const kind = !device.online ? "offline" : ["direct", "relay", "offline", "idle"].includes(device.connection)
    ? device.connection
    : "idle";
  const label = kind === "direct"
    ? "直连"
    : kind === "relay"
      ? "DERP 中继"
      : kind === "offline" ? "未连接" : device.self ? "本机节点" : "等待连接";
  return { kind, label };
}

function deviceCard(device, compact = false) {
  const system = osDescriptor(device);
  const connection = connectionDescriptor(device);
  const address = device.ips?.[0] || "—";
  return `<article class="device-card ${compact ? "compact-card" : ""}">
    <div class="device-identity"><div class="os-icon ${system.kind}">${osIcon(system.kind)}</div>
    <div class="device-card-copy">
      <div class="device-card-heading">
        <strong title="${escapeHTML(device.name || "未命名设备")}">${escapeHTML(device.name || "未命名设备")}</strong>
        ${device.self ? '<span class="self-tag">本机</span>' : ""}
      </div>
      <p>${escapeHTML(system.label)}${device.exit_node_option ? " · Exit Node" : ""}</p>
    </div></div>
    <div class="device-address mono">${escapeHTML(address)}</div>
    <div class="device-route"><span class="connection-badge ${connection.kind}">${escapeHTML(connection.label)}</span><small>${device.relay ? `${device.online ? "DERP" : "上次 DERP"} · ${escapeHTML(device.relay)}` : device.self ? "本机网络" : "暂无 DERP 信息"}</small></div>
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
  const preview = appState.devices.slice(0, 5);
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

function setStateLabel(element, label, state = "") {
  element.textContent = label;
  element.classList.toggle("enabled", state === "enabled");
  element.classList.toggle("warning", state === "warning");
}

function renderExitNode(status) {
  const known = status.exit_node_state_known === true;
  const advertised = known && status.exit_node_advertised;
  const enabled = known && status.exit_node_enabled === true;
  const label = !known ? "状态待确认" : enabled ? "本机已启用" : advertised ? "尚未就绪" : "已关闭";
  const state = enabled ? "enabled" : !known || advertised ? "warning" : "";
  const needsAttention = !known || Boolean(advertised && !enabled);
  if (needsAttention && !appState.exitNeedsAttention) elements.exitDiagnostics.open = true;
  appState.exitNeedsAttention = needsAttention;
  if (!appState.exitNodeBusy) {
    // An unknown state stays visually mixed; the first click requests cleanup.
    elements.exitNodeToggle.checked = known ? Boolean(advertised) : true;
    elements.exitNodeToggle.indeterminate = !known;
    elements.exitNodeToggle.disabled = appState.connectionBusy || (!status.logged_in && known && !advertised);
    setStateLabel(elements.exitNodeState, label, state);
  }
  setStateLabel(elements.overviewExitStatus, label, state);
  setStateLabel(elements.exitConnectionState, status.connected ? "已连接" : "未连接", status.connected ? "enabled" : "warning");
  setStateLabel(elements.exitAdvertiseState, !known ? "无法读取" : advertised ? "正在广播" : "已停止", advertised ? "enabled" : !known ? "warning" : "");
  setStateLabel(elements.exitIPv4State, status.ipv4_forwarding ? "已开启" : "未开启", status.ipv4_forwarding ? "enabled" : advertised ? "warning" : "");
  setStateLabel(elements.exitIPv6State, status.ipv6_forwarding_available === false ? "系统未提供" : status.ipv6_forwarding ? "已开启" : "未开启", status.ipv6_forwarding ? "enabled" : advertised && status.ipv6_forwarding_available !== false ? "warning" : "");
  const approved = status.exit_node_approval === "approved";
  setStateLabel(elements.exitApprovalState, approved ? "已获控制台批准" : "需在控制台确认", approved ? "enabled" : "");
  elements.exitNodeNote.textContent = !known
    ? "暂时无法读取本机出口广播状态，请刷新重试；关闭开关可尝试停止广播并清理本应用的转发配置。"
    : enabled
      ? approved
        ? "本机已连接并广播出口路由，IP 转发已就绪，控制台已批准此设备。其他设备选择本机作为出口后即可使用。"
        : "本机已连接并广播出口路由，IP 转发已就绪。首次使用仍需在管理控制台批准，再由其他设备选择本机作为出口。"
      : advertised
        ? "出口广播已配置，连接或 IP 转发尚未就绪。请查看下方检查结果，也可关闭后重新开启。"
        : "开启后会连接本机、广播出口路由并验证 IP 转发。关闭后停止出口广播，并恢复本应用管理的转发设置。";
  elements.overviewExitDescription.textContent = enabled
    ? approved ? "本机出口服务已就绪且获批，其他设备可选择本机作为出口。" : "本机出口服务已就绪；在控制台确认授权后，其他设备即可选择本机。"
    : advertised
      ? "出口广播已配置，本机连接或 IP 转发仍需检查。"
      : !known
        ? "尚未确认本机状态，前往设置查看连接与转发详情。"
        : "让获准的设备通过这台 NAS 访问互联网。";
}

function renderStatus(status) {
  appState.status = status;
  appState.devices = status.devices || [];
  elements.packageVersion.textContent = status.package_version || "开发构建";
  const revision = status.package_version?.match(/-fnos\.(.+)$/)?.[1];
  elements.versionValue.textContent = revision ? `v${revision}` : status.package_version || "—";
  elements.versionValue.title = status.package_version || "";
  elements.settingsVersion.textContent = status.package_version || "—";
  elements.tailscaleVersion.textContent = status.tailscale_version || "—";
  elements.lastUpdated.textContent = `同步于 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  elements.backendState.textContent = backendLabel(status.backend_state);
  elements.connectionCard.classList.toggle("connected", Boolean(status.connected));
  elements.connectionCard.classList.toggle("warning", !status.connected && Boolean(status.logged_in));
  elements.statusDot.className = `status-dot ${status.connected ? "connected" : status.logged_in ? "warning" : "error"}`;
  elements.powerButton.disabled = appState.connectionBusy || appState.exitNodeBusy;
  elements.powerButton.classList.toggle("connected", status.connected);
  if (!appState.connectionBusy) elements.powerLabel.textContent = status.connected ? "断开连接" : status.logged_in ? "重新连接" : "登录连接";
  elements.powerButton.setAttribute("aria-label", status.connected ? "断开 Tailscale 连接" : status.logged_in ? "重新连接 Tailscale" : "登录 Tailscale");
  elements.connectionDescription.textContent = status.connected
    ? "可通过 Tailscale IP 安全访问本机与获准设备。"
    : status.backend_state === "NeedsMachineAuth"
      ? "设备已经登录，正在等待 Tailnet 管理员批准。"
      : status.logged_in
      ? "设备身份仍然保留，点击电源按钮即可重新接入 Tailnet。"
      : "使用浏览器或 Auth Key 登录后即可接入你的 Tailnet。";

  const self = status.self;
  const primaryIP = status.tailscale_ips?.[0] || self?.ips?.[0] || "—";
  elements.identityRow.hidden = !self;
  elements.selfName.textContent = self?.name || "—";
  elements.sidebarDeviceName.textContent = self?.name || "本机 fnOS";
  elements.sidebarStatus.textContent = status.connected ? "已连接到 Tailnet" : backendLabel(status.backend_state);
  elements.tailnetName.textContent = status.tailnet || "Tailnet";
  elements.onlineCount.textContent = status.online_count ?? 0;
  elements.totalCount.textContent = ` / ${status.total_count ?? 0}`;
  elements.devicePageOnline.textContent = status.online_count ?? 0;
  elements.tailscaleIP.textContent = primaryIP;
  elements.copyIPButton.disabled = primaryIP === "—";
  if (!appState.hostnameDirty && document.activeElement !== elements.hostnameInput) elements.hostnameInput.value = self?.name || "";
  elements.hostnameInput.disabled = !status.logged_in;
  elements.hostnameForm.querySelector("button").disabled = !status.logged_in || appState.hostnameBusy;
  renderExitNode(status);
  const health = status.health || [];
  elements.healthPanel.hidden = health.length === 0;
  elements.healthList.innerHTML = health.map((message) => `<li>${escapeHTML(message)}</li>`).join("");
  elements.accountDeviceName.textContent = self?.name || "尚未登录";
  elements.accountTailnet.textContent = status.tailnet || "—";
  elements.accountIP.textContent = primaryIP;
  elements.logoutButton.disabled = !status.logged_in || appState.exitNodeBusy;
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
  appState.latencyMeasured = false;
  elements.backendState.textContent = "本机服务不可用";
  elements.connectionCard.classList.remove("connected", "warning");
  elements.statusDot.className = "status-dot error";
  elements.connectionDescription.textContent = message;
  elements.powerButton.disabled = true;
  elements.powerButton.classList.remove("connected");
  elements.powerLabel.textContent = "不可用";
  elements.onlineCount.textContent = "—";
  elements.totalCount.textContent = " / —";
  elements.devicePageOnline.textContent = "—";
  elements.tailscaleIP.textContent = "—";
  elements.latencyValue.textContent = "—";
  elements.latencyUnit.textContent = "";
  elements.latencyRegion.textContent = "等待本机服务恢复";
  elements.identityRow.hidden = true;
  elements.sidebarStatus.textContent = "本机服务不可用";
  elements.lastUpdated.textContent = "同步失败";
  elements.copyIPButton.disabled = true;
  elements.healthPanel.hidden = true;
  elements.exitNodeToggle.indeterminate = true;
  setStateLabel(elements.exitNodeState, "状态未知", "warning");
  setStateLabel(elements.overviewExitStatus, "状态未知", "warning");
  elements.overviewExitDescription.textContent = "无法连接本机服务，请刷新后查看出口状态。";
  elements.exitNodeNote.textContent = "无法读取本机状态。请确认应用已启动，再刷新重试。";
  elements.exitDiagnostics.open = true;
  appState.exitNeedsAttention = true;
  [elements.exitConnectionState, elements.exitAdvertiseState, elements.exitIPv4State, elements.exitIPv6State].forEach((element) => setStateLabel(element, "无法读取", "warning"));
  setStateLabel(elements.exitApprovalState, "无法确认", "warning");
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
  if (appState.refreshing) return appState.refreshPromise;
  appState.refreshing = true;
  elements.refreshButton.classList.add("loading");
  const epoch = appState.statusEpoch;
  appState.refreshPromise = (async () => {
    try {
      const status = await request("status");
      if (epoch === appState.statusEpoch) renderStatus(status);
    } catch (error) {
      if (epoch === appState.statusEpoch) renderUnavailable(error.message);
      if (showError) toast(error.message, "error");
    } finally {
      appState.refreshing = false;
      elements.refreshButton.classList.remove("loading");
    }
  })();
  return appState.refreshPromise;
}

async function refreshAfterAction() {
  appState.statusEpoch += 1;
  await appState.refreshPromise;
  await loadStatus();
}

async function toggleConnection() {
  const status = appState.status;
  if (!status || appState.connectionBusy || appState.exitNodeBusy) return;
  if (!status.logged_in) {
    elements.loginDialog.showModal();
    return;
  }
  if (status.connected && !window.confirm("确认断开当前设备的 Tailscale 连接？设备身份和设置会保留。")) return;
  appState.connectionBusy = true;
  appState.statusEpoch += 1;
  elements.powerButton.disabled = true;
  elements.exitNodeToggle.disabled = true;
  elements.logoutButton.disabled = true;
  elements.powerLabel.textContent = status.connected ? "正在断开" : "正在连接";
  try {
    const result = await post(status.connected ? "down" : "connect");
    if (result.auth_url) showAuthLink(result.auth_url);
    toast(status.connected ? "Tailscale 已断开" : "Tailscale 已连接", "success");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    appState.connectionBusy = false;
    await refreshAfterAction();
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
  elements.browserTab.setAttribute("tabindex", browser ? "0" : "-1");
  elements.keyTab.setAttribute("tabindex", browser ? "-1" : "0");
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
  if (appState.hostnameBusy) return;
  const hostname = elements.hostnameInput.value.trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(hostname)) {
    toast("名称需为 1–63 位英文字母、数字或连字符，且不能以连字符开头或结尾", "error");
    return;
  }
  const button = elements.hostnameForm.querySelector("button");
  appState.hostnameBusy = true;
  setBusy(button, true, "保存中");
  try {
    await post("hostname", { hostname });
    appState.hostnameDirty = false;
    toast("设备名称已更新", "success");
    await refreshAfterAction();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    appState.hostnameBusy = false;
    setBusy(button, false);
  }
}

async function toggleExitNode() {
  if (appState.exitNodeBusy || appState.connectionBusy) return;
  const enabled = elements.exitNodeToggle.checked;
  appState.exitNodeBusy = true;
  appState.statusEpoch += 1;
  elements.exitNodeToggle.indeterminate = false;
  elements.exitNodeToggle.disabled = true;
  elements.powerButton.disabled = true;
  elements.logoutButton.disabled = true;
  elements.exitNodeToggle.setAttribute("aria-busy", "true");
  setStateLabel(elements.exitNodeState, enabled ? "正在启用…" : "正在关闭…", "warning");
  elements.exitNodeNote.textContent = enabled ? "正在配置本机连接、出口广播和 IP 转发，请稍候。" : "正在停止出口广播并恢复本应用管理的转发设置，请稍候。";
  try {
    const result = await post("exit-node", { enabled });
    toast(result.enabled ? "本机 Exit Node 已启用，请在控制台确认授权" : "本机 Exit Node 已关闭", "success");
    if (result.warnings?.length) toast(result.warnings.join("；"));
  } catch (error) {
    toast(error.message, "error");
  } finally {
    appState.exitNodeBusy = false;
    elements.exitNodeToggle.setAttribute("aria-busy", "false");
    await refreshAfterAction();
  }
}

async function copyIP() {
  const address = appState.status?.tailscale_ips?.[0] || appState.status?.self?.ips?.[0];
  if (!address) return;
  try {
    if (window.navigator?.clipboard?.writeText) {
      await window.navigator.clipboard.writeText(address);
    } else {
      const input = document.createElement("textarea");
      input.value = address;
      input.setAttribute("readonly", "");
      input.className = "clipboard-input";
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      elements.copyIPButton.focus();
      if (!copied) throw new Error("copy unavailable");
    }
    toast(`已复制 ${address}`, "success");
  } catch {
    toast(`请手动复制地址：${address}`);
  }
}

async function measureLatency(showError = true) {
  elements.latencyButton.disabled = true;
  elements.latencyButton.textContent = "检测中";
  elements.latencyValue.textContent = "…";
  elements.latencyUnit.textContent = "";
  try {
    const result = await request("latency");
    const hasLatency = result.nearest_ms != null && Number.isFinite(Number(result.nearest_ms)) && Number(result.nearest_ms) > 0;
    elements.latencyValue.textContent = hasLatency ? Number(result.nearest_ms).toFixed(1) : "—";
    elements.latencyUnit.textContent = hasLatency ? " ms" : "";
    elements.latencyRegion.textContent = result.preferred_derp ? `首选 DERP #${result.preferred_derp}` : "未找到可用 DERP";
    elements.latencyButton.title = result.preferred_derp ? `首选 DERP #${result.preferred_derp}` : "未找到可用 DERP";
  } catch (error) {
    elements.latencyValue.textContent = "—";
    elements.latencyRegion.textContent = "检测未完成，可点击重测";
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
  const fontScale = clamp(appState.appearance.fontScale, 70, 160, 100);
  const uiZoom = clamp(appState.appearance.uiZoom, 50, 160, 100);
  appState.appearance = { fontScale, uiZoom };
  document.documentElement.style.setProperty("--font-delta", `${4 + (fontScale - 100) / 5}px`);
  document.documentElement.style.setProperty("--ui-zoom", String(Number((0.8 * uiZoom / 100).toFixed(3))));
  elements.fontScaleInput.value = String(fontScale);
  elements.fontScaleValue.value = String(fontScale);
  elements.uiZoomInput.value = String(uiZoom);
  elements.uiZoomValue.value = String(uiZoom);
  if (save) window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appState.appearance));
}

function loadAppearance() {
  let stored = null;
  try {
    stored = JSON.parse(window.localStorage.getItem(APPEARANCE_KEY) || "null");
  } catch {
    window.localStorage.removeItem(APPEARANCE_KEY);
  }
  if (stored) {
    appState.appearance = stored;
    applyAppearance(false);
    return;
  }

  try {
    const legacy = JSON.parse(window.localStorage.getItem(LEGACY_APPEARANCE_KEY) || "null");
    if (legacy) {
      appState.appearance = {
        fontScale: clamp(Number(legacy.fontScale) - 20, 70, 160, 100),
        uiZoom: clamp(Number(legacy.uiZoom) / 0.8, 50, 160, 100)
      };
      applyAppearance(true);
      return;
    }
  } catch {
    window.localStorage.removeItem(LEGACY_APPEARANCE_KEY);
  }
  applyAppearance(false);
}

function resetAppearance() {
  appState.appearance = { ...DEFAULT_APPEARANCE };
  applyAppearance(true);
  toast("显示设置已恢复默认", "success");
}

function previewAppearance(property, input, valueInput, minimum, maximum) {
  const value = clamp(input.value, minimum, maximum, DEFAULT_APPEARANCE[property]);
  appState.appearance[property] = value;
  valueInput.value = String(value);
}

function commitAppearance(property, input, valueInput, minimum, maximum) {
  previewAppearance(property, input, valueInput, minimum, maximum);
  applyAppearance(true);
}

function commitAppearanceValue(property, input, valueInput, minimum, maximum) {
  const fallback = clamp(appState.appearance[property], minimum, maximum, DEFAULT_APPEARANCE[property]);
  const value = clamp(valueInput.value, minimum, maximum, fallback);
  appState.appearance[property] = value;
  input.value = String(value);
  valueInput.value = String(value);
  applyAppearance(true);
}

function commitAppearanceValueOnEnter(event) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  event.currentTarget.blur();
}

document.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.page)));
document.querySelectorAll("[data-settings-tab]").forEach((tab) => {
  tab.addEventListener("click", () => selectSettingsTab(tab.dataset.settingsTab));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = settingsTabs.indexOf(tab.dataset.settingsTab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? settingsTabs.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + settingsTabs.length) % settingsTabs.length;
    selectSettingsTab(settingsTabs[next], true);
  });
});
document.querySelectorAll("[data-device-filter]").forEach((button) => button.addEventListener("click", () => {
  appState.deviceFilter = button.dataset.deviceFilter;
  appState.devicePage = 1;
  document.querySelectorAll("[data-device-filter]").forEach((item) => {
    item.classList.toggle("active", item === button);
    item.setAttribute("aria-pressed", String(item === button));
  });
  renderDevices();
}));
elements.refreshButton.addEventListener("click", () => loadStatus(true));
elements.powerButton.addEventListener("click", toggleConnection);
elements.viewAllDevices.addEventListener("click", () => navigate("devices"));
elements.overviewSettingsButton.addEventListener("click", () => {
  selectSettingsTab("network");
  navigate("settings");
});
elements.openExitSettings.addEventListener("click", () => {
  selectSettingsTab("network");
  navigate("settings");
  elements.exitNodeToggle.focus();
});
elements.copyIPButton.addEventListener("click", copyIP);
elements.deviceSearch.addEventListener("input", () => { appState.devicePage = 1; renderDevices(); });
elements.devicePrev.addEventListener("click", () => { appState.devicePage -= 1; renderDevices(); });
elements.deviceNext.addEventListener("click", () => { appState.devicePage += 1; renderDevices(); });
elements.hostnameForm.addEventListener("submit", saveHostname);
elements.hostnameInput.addEventListener("input", () => { appState.hostnameDirty = true; });
elements.exitNodeToggle.addEventListener("change", toggleExitNode);
elements.logoutButton.addEventListener("click", logout);
elements.latencyButton.addEventListener("click", () => measureLatency(true));
elements.updateButton.addEventListener("click", () => checkUpdate(true));
elements.browserTab.addEventListener("click", () => selectLoginTab("browser"));
elements.keyTab.addEventListener("click", () => selectLoginTab("key"));
[elements.browserTab, elements.keyTab].forEach((tab) => tab.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const mode = event.key === "Home" ? "browser" : event.key === "End" ? "key" : tab === elements.browserTab ? "key" : "browser";
  selectLoginTab(mode);
  (mode === "browser" ? elements.browserTab : elements.keyTab).focus();
}));
elements.browserLoginButton.addEventListener("click", browserLogin);
elements.keyLoginButton.addEventListener("click", authKeyLogin);
// Keep the page geometry fixed while a range thumb is being dragged. Applying
// CSS zoom on every input event moves the range under the pointer and can make
// the browser recalculate an unintended value (most visibly the 50% minimum).
elements.fontScaleInput.addEventListener("input", () => previewAppearance("fontScale", elements.fontScaleInput, elements.fontScaleValue, 70, 160));
elements.fontScaleInput.addEventListener("change", () => commitAppearance("fontScale", elements.fontScaleInput, elements.fontScaleValue, 70, 160));
elements.uiZoomInput.addEventListener("input", () => previewAppearance("uiZoom", elements.uiZoomInput, elements.uiZoomValue, 50, 160));
elements.uiZoomInput.addEventListener("change", () => commitAppearance("uiZoom", elements.uiZoomInput, elements.uiZoomValue, 50, 160));
elements.fontScaleValue.addEventListener("change", () => commitAppearanceValue("fontScale", elements.fontScaleInput, elements.fontScaleValue, 70, 160));
elements.fontScaleValue.addEventListener("keydown", commitAppearanceValueOnEnter);
elements.uiZoomValue.addEventListener("change", () => commitAppearanceValue("uiZoom", elements.uiZoomInput, elements.uiZoomValue, 50, 160));
elements.uiZoomValue.addEventListener("keydown", commitAppearanceValueOnEnter);
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
appState.statusTimer = window.setInterval(() => {
  if (!appState.exitNodeBusy && !appState.connectionBusy) return loadStatus(false);
}, 10000);
