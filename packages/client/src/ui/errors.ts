// Errors shown on screen, not just in the console: phones have no dev tools to look at.
let box: HTMLElement | null = null;

export function showError(message: string) {
  console.error(message);
  if (!box) {
    box = document.createElement("pre");
    box.className = "errors";
    document.body.appendChild(box);
  }
  box.textContent = `${box.textContent ? `${box.textContent}\n` : ""}${message}`.split("\n").slice(-8).join("\n");
}

export function installErrorOverlay() {
  addEventListener("error", (e) => showError(`${e.message} (${(e.filename || "").split("/").pop()}:${e.lineno})`));
  addEventListener("unhandledrejection", (e) => showError(`${e.reason?.message ?? e.reason}`));
}
