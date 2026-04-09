const btnStart    = document.getElementById("start");
const btnStop     = document.getElementById("stop");
const progressBar = document.getElementById("progress-bar");
const spinner     = document.getElementById("spinner");
const statusEl    = document.getElementById("status");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

function setRunning(on) {
  btnStart.disabled = on;
  btnStop.disabled  = !on;
  progressBar.classList.toggle("hidden", !on);
  spinner.classList.toggle("hidden", !on);
}

async function focusedTabId() {
  let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id != null) return tab.id;
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

function selectedMode() {
  return (document.querySelector('input[name="mode"]:checked') || {}).value || "likes";
}

// ── Restore state when popup reopens ─────────────────────────────────────────
(async () => {
  try {
    const { igWipeRunning } = await chrome.storage.session.get("igWipeRunning");
    if (igWipeRunning) {
      setRunning(true);
      setStatus("Running — check the Instagram tab.", "ok");
    }
  } catch { /* ignore */ }
})();

// ── Watch for the loop finishing on its own ───────────────────────────────────
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session") return;
  if ("igWipeRunning" in changes && !changes.igWipeRunning.newValue) {
    setRunning(false);
    // Only update status if it currently says "Running"
    if (statusEl.classList.contains("ok") && statusEl.textContent.startsWith("Running")) {
      setStatus("Done — no more items found.", "ok");
    }
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
btnStart.addEventListener("click", async () => {
  setStatus("Starting…");
  setRunning(true);

  const tabId = await focusedTabId();
  if (tabId == null) {
    setStatus("No tab found. Focus the Instagram tab, then open this popup again.", "err");
    setRunning(false);
    return;
  }

  const mode      = selectedMode();
  const batchSize = Math.min(50, Math.max(1, parseInt(document.getElementById("batchSize").value, 10) || 20));

  await chrome.storage.session.set({ igWipeStop: false, igWipeRunning: true });

  try {
    const rsp = await chrome.runtime.sendMessage({ type: "START_DELETION", tabId, mode, batchSize });
    if (rsp?.ok) {
      setStatus(
        rsp.navigated
          ? "Navigating to Your Activity… deletion will start automatically."
          : "Running — check the Instagram tab.",
        "ok"
      );
    } else {
      setStatus(rsp?.error || "Could not start.", "err");
      setRunning(false);
      await chrome.storage.session.set({ igWipeRunning: false });
    }
  } catch (e) {
    setStatus("Error: " + (e?.message || e), "err");
    setRunning(false);
    await chrome.storage.session.set({ igWipeRunning: false });
  }
});

// ── Stop ──────────────────────────────────────────────────────────────────────
btnStop.addEventListener("click", async () => {
  setStatus("Stopping…");
  const tabId = await focusedTabId();
  try {
    await chrome.runtime.sendMessage({ type: "STOP_DELETION", tabId });
    await chrome.storage.session.set({ igWipeRunning: false });
    setRunning(false);
    setStatus("Stopped.", "ok");
  } catch (e) {
    setStatus("Stop failed: " + (e?.message || e), "err");
    setRunning(false);
  }
});
