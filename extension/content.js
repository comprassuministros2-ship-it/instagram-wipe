if (window.__igWipeInstalled) {
  /* already loaded by declarative content script */
} else {
  window.__igWipeInstalled = true;

  (() => {
    const CIRCLE_PREFIX =
      'mask-image: url("https://i.instagram.com/static/images/bloks/icons/generated/circle__outline';

    let stopRequested = false;
    let running = false;

    function sleep(ms) {
      const jittered = Math.round(ms * (0.85 + Math.random() * 0.3));
      return new Promise((r) => setTimeout(r, jittered));
    }

    function scriptClick(el) {
      if (!el || !el.isConnected) return;
      try {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      } catch { /* ignore */ }
      try { el.click(); } catch { /* ignore */ }
    }

    async function isStopped() {
      if (stopRequested) return true;
      try {
        const { igWipeStop } = await chrome.storage.session.get("igWipeStop");
        return Boolean(igWipeStop);
      } catch {
        return false;
      }
    }

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === "STOP_DELETION") {
        stopRequested = true;
        sendResponse({ ok: true });
        return true;
      }
      if (msg?.type === "START_DELETION") {
        stopRequested = false;
        if (running) {
          sendResponse({ ok: true, note: "already_running" });
          return true;
        }
        runDeletion(msg.mode, msg.batchSize).catch(() => {});
        sendResponse({ ok: true });
        return true;
      }
    });

    async function runDeletion(mode, batchSize) {
      running = true;
      const n = Math.min(50, Math.max(1, Number(batchSize) || 20));
      const deleteText = mode === "likes" ? "Unlike" : "Delete";

      try {
        while (!(await isStopped())) {

          // Step 1 — wait for and click "Select"
          let clickedSelect = false;
          while (!clickedSelect && !(await isStopped())) {
            await sleep(2000);
            const spans = Array.from(
              document.querySelectorAll('span[data-bloks-name="bk.components.Text"]')
            );
            for (const el of spans) {
              const t = (el.textContent || "").trim();
              if (t === "Select") {
                const done = spans.some(
                  (j) =>
                    (j.textContent || "").trim() === "No results" ||
                    (j.textContent || "").trim().startsWith("You haven't")
                );
                if (done) {
                  await chrome.storage.session.set({ igWipeStop: true });
                  return;
                }
                scriptClick(el);
                clickedSelect = true;
                break;
              }
              if (t.startsWith("You haven't")) {
                await chrome.storage.session.set({ igWipeStop: true });
                return;
              }
            }
          }

          if (await isStopped()) return;

          // Step 2 — select up to n items
          let selectedCount = 0;
          while (selectedCount === 0 && !(await isStopped())) {
            await sleep(1000);
            const icons = document.querySelectorAll(
              'div[data-bloks-name="ig.components.Icon"]'
            );
            for (const icon of icons) {
              const style = icon.getAttribute("style") || "";
              if (style.startsWith(CIRCLE_PREFIX)) {
                scriptClick(icon);
                selectedCount++;
                await sleep(300);
                if (selectedCount >= n) break;
              }
            }
          }

          if (await isStopped()) return;

          if (selectedCount === 0) {
            await chrome.storage.session.set({ igWipeStop: true });
            return;
          }

          // Step 3 — click Delete / Unlike
          let deleteClicked = false;
          await sleep(1000);
          for (const span of document.querySelectorAll(
            'span[data-bloks-name="bk.components.TextSpan"]'
          )) {
            if ((span.textContent || "").trim() === deleteText) {
              scriptClick(span);
              deleteClicked = true;
              break;
            }
          }

          if (!deleteClicked) {
            // button not found — reload and retry
            await sleep(2000);
            location.reload();
            await sleep(3000);
            continue;
          }

          // Step 4 — confirm dialog
          let confirmed = false;
          while (!confirmed && !(await isStopped())) {
            await sleep(1000);
            for (const btn of document.querySelectorAll('div[role="dialog"] button')) {
              let btnText = "";
              try {
                const inner = btn.querySelector("div");
                btnText = inner ? (inner.textContent || "").trim() : "";
              } catch { continue; }

              if (btnText === deleteText) {
                scriptClick(btn);
                confirmed = true;
                break;
              }
              if (btnText === "OK") {
                // rate-limited — dismiss and reload
                scriptClick(btn);
                await sleep(2000);
                location.reload();
                await sleep(3000);
                confirmed = true;
                break;
              }
            }
          }

          if (await isStopped()) return;

          // Step 5 — brief pause before the next batch
          await sleep(3000);
        }
      } finally {
        running = false;
        try {
          await chrome.storage.session.set({ igWipeRunning: false });
        } catch { /* ignore */ }
      }
    }
  })();
}
