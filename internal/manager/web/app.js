"use strict";

const elements = Object.fromEntries([
  "packageVersion", "refreshButton", "statusDot", "backendState", "connectionDescription",
  "identityRow", "selfName", "tailnetName", "powerButton", "powerLabel", "onlineCount",
  "totalCount", "latencyValue", "latencyUnit", "latencyButton", "tailscaleIP", "versionValue",
  "updateState", "deviceRows", "deviceSearch", "hostnameForm", "hostnameInput", "exitNodeToggle",
  "exitNodeNote", "updateButton", "updateDescription", "releaseLink", "loginDialog", "browserTab",
  "keyTab", "browserPane", "keyPane", "browserLoginButton", "authLink", "authKeyInput",
  "keyLoginButton", "toastRegion"
].map((id) => [id, document.getElementById(id)]));

const appState = {
  status: null,
  devices: [],
  refreshing: false,
  latencyMeasured: false,
  statusTimer: null
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

function renderStatus(status) {
  appState.status = status;
  appState.devices = status.devices || [];
  elements.packageVersion.textContent = status.package_version || "fnos.0.1";
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
  elements.identityRow.hidden = !self;
  elements.selfName.textContent = self?.name || "—";
  elements.tailnetName.textContent = status.tailnet || "Tailnet";
  elements.onlineCount.textContent = status.online_count ?? 0;
  elements.totalCount.textContent = ` / ${status.total_count ?? 0}`;
  elements.tailscaleIP.textContent = status.tailscale_ips?.[0] || self?.ips?.[0] || "—";
  elements.hostnameInput.value = self?.name || "";
  elements.exitNodeToggle.checked = Boolean(status.exit_node_advertised);
  elements.exitNodeToggle.disabled = !status.logged_in;
  elements.exitNodeNote.textContent = status.exit_node_advertised
    ? "正在广播 Exit Node。首次启用后仍需在 Tailscale 管理后台批准。"
    : "启用后会打开运行时 IP 转发，并需要在 Tailscale 管理后台批准此设备。";
  renderDevices();

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
  elements.tailscaleIP.textContent = "—";
  elements.exitNodeToggle.disabled = true;
  renderDevices();
}

function renderDevices() {
  const query = elements.deviceSearch.value.trim().toLowerCase();
  const devices = appState.devices.filter((device) => {
    const haystack = [device.name, device.dns_name, ...(device.ips || [])].join(" ").toLowerCase();
    return !query || haystack.includes(query);
  });
  if (!devices.length) {
    elements.deviceRows.innerHTML = `<tr><td colspan="4"><div class="empty-state">${query ? "没有匹配的设备" : "暂无可显示的设备"}</div></td></tr>`;
    return;
  }
  elements.deviceRows.innerHTML = devices.map((device) => {
    const name = escapeHTML(device.name);
    const initials = escapeHTML((device.name || "?").slice(0, 2));
    const address = escapeHTML(device.ips?.[0] || "—");
    const osName = escapeHTML(device.os || "unknown");
    const connection = device.connection === "direct"
      ? "直连"
      : device.connection === "relay"
        ? `DERP ${escapeHTML(device.relay || "")}`
        : device.connection === "offline" ? "离线" : "空闲";
    return `<tr>
      <td><div class="device-cell"><div class="device-avatar ${device.self ? "self" : ""}">${initials}</div><div><div class="device-name">${name}${device.self ? '<span class="self-tag">本机</span>' : ""}</div><div class="device-meta">${osName}${device.exit_node_option ? " · Exit Node" : ""}</div></div></div></td>
      <td class="mono">${address}</td>
      <td><span class="connection-badge ${escapeHTML(device.connection)}">${connection}</span></td>
      <td><span class="status-badge ${device.online ? "online" : ""}">${device.online ? "在线" : "离线"}</span></td>
    </tr>`;
  }).join("");
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

async function browserLogin() {
  setBusy(elements.browserLoginButton, true, "正在生成…");
  try {
    const result = await post("login/browser");
    if (result.auth_url) {
      showAuthLink(result.auth_url);
      toast("授权链接已经生成，请在新页面完成登录", "success");
    } else {
      toast("设备已经登录并连接", "success");
      elements.loginDialog.close();
    }
  } catch (error) {
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
    elements.releaseLink.href = result.release_url;
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

elements.refreshButton.addEventListener("click", () => loadStatus(true));
elements.powerButton.addEventListener("click", toggleConnection);
elements.deviceSearch.addEventListener("input", renderDevices);
elements.hostnameForm.addEventListener("submit", saveHostname);
elements.exitNodeToggle.addEventListener("change", toggleExitNode);
elements.latencyButton.addEventListener("click", () => measureLatency(true));
elements.updateButton.addEventListener("click", () => checkUpdate(true));
elements.browserTab.addEventListener("click", () => selectLoginTab("browser"));
elements.keyTab.addEventListener("click", () => selectLoginTab("key"));
elements.browserLoginButton.addEventListener("click", browserLogin);
elements.keyLoginButton.addEventListener("click", authKeyLogin);
elements.loginDialog.addEventListener("close", () => {
  elements.authKeyInput.value = "";
  elements.authLink.hidden = true;
});

loadStatus();
checkUpdate(false);
appState.statusTimer = window.setInterval(() => loadStatus(false), 10000);
