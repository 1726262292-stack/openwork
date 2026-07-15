import { describe, expect, test } from "bun:test";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  createEditor,
} from "lexical";
import {
  insertStyledPastedText,
  PASTED_TEXT_INLINE_STYLE,
} from "../src/react-app/domains/session/surface/composer/pasted-text-insertion";

describe("styled pasted-text insertion", () => {
  test("styles pasted text, preserves newlines, and clears style before typed text", () => {
    const editor = createEditor({
      namespace: "styled-pasted-text-test",
      onError(error) {
        throw error;
      },
    });
    const textChunks: { text: string; style: string }[] = [];
    let lineBreaks = 0;
    let textContent = "";

    editor.update(() => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      root.clear();
      root.append(paragraph);
      paragraph.select();

      expect(insertStyledPastedText("first\nsecond")).toBeTrue();
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) throw new Error("Expected range selection after pasted text insertion.");
      selection.insertText(" typed");
    }, { discrete: true });

    editor.getEditorState().read(() => {
      const root = $getRoot();
      textContent = root.getTextContent();
      const paragraph = root.getFirstChild();
      if (!$isElementNode(paragraph)) throw new Error("Expected the paste to stay in a paragraph.");

      for (const child of paragraph.getChildren()) {
        if ($isTextNode(child)) {
          textChunks.push({ text: child.getTextContent(), style: child.getStyle() });
        }
        if ($isLineBreakNode(child)) lineBreaks += 1;
      }
    });

    expect(textContent).toBe("first\nsecond typed");
    expect(lineBreaks).toBe(1);
    expect(textChunks).toEqual([
      { text: "first", style: PASTED_TEXT_INLINE_STYLE },
      { text: "second", style: PASTED_TEXT_INLINE_STYLE },
      { text: " typed", style: "" },
    ]);
  });
});
