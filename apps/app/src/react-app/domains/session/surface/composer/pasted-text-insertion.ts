import {
  $createLineBreakNode,
  $createTabNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  type LexicalNode,
} from "lexical";

export const PASTED_TEXT_INLINE_STYLE = "background-color: rgba(229, 231, 235, 0.6); border-radius: 4px; box-decoration-break: clone; -webkit-box-decoration-break: clone; padding: 1px 2px;";

function createStyledPastedTextNodes(text: string) {
  const nodes: LexicalNode[] = [];
  const parts = text.split(/(\r?\n|\t)/);

  for (const part of parts) {
    if (part === "\n" || part === "\r\n") {
      nodes.push($createLineBreakNode());
    } else if (part === "\t") {
      nodes.push($createTabNode());
    } else {
      const textNode = $createTextNode(part);
      textNode.setStyle(PASTED_TEXT_INLINE_STYLE);
      nodes.push(textNode);
    }
  }

  return nodes;
}

export function insertStyledPastedText(text: string) {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  selection.insertNodes(createStyledPastedTextNodes(text));
  const nextSelection = $getSelection();
  if ($isRangeSelection(nextSelection)) nextSelection.setStyle("");
  return true;
}
