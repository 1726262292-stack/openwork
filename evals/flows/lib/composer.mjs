const EDITOR_SELECTOR = '[contenteditable="true"][data-lexical-editor="true"], [contenteditable="true"]';

export async function setComposerText(ctx, text) {
  await ctx.waitFor(`Boolean(document.querySelector(${JSON.stringify(EDITOR_SELECTOR)}))`, {
    timeoutMs: 30_000,
    label: "composer contenteditable",
  });
  const pasted = await ctx.eval(`(() => {
    const editor = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
    if (!editor) return false;
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const data = new DataTransfer();
    data.setData("text/plain", ${JSON.stringify(text)});
    editor.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    }));
    return true;
  })()`);
  ctx.assert(pasted === true, "Could not paste text into the composer contenteditable.");
  await ctx.waitFor(`(() => {
    const editor = document.querySelector(${JSON.stringify(EDITOR_SELECTOR)});
    return Boolean(editor && (editor.innerText || "").includes(${JSON.stringify(text)}));
  })()`, { timeoutMs: 30_000, label: "composer draft text" });
}
