import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { Agent } from "@opencode-ai/sdk/v2/client";
import { ArrowUp, AtSign, ChevronDown, File, History, Mic, Paperclip, X, Zap } from "lucide-solid";

import type { ComposerAttachment, ComposerDraft, ComposerPart, PromptMode } from "../../types";

type MentionOption = {
  id: string;
  kind: "agent" | "file";
  label: string;
  value: string;
  detail?: string;
};

type MentionSection = {
  title: string;
  options: MentionOption[];
};

type ComposerProps = {
  prompt: string;
  busy: boolean;
  onSend: (draft: ComposerDraft) => void;
  onDraftChange: (draft: ComposerDraft) => void;
  selectedModelLabel: string;
  onModelClick: () => void;
  modelVariantLabel: string;
  modelVariant: string | null;
  onModelVariantChange: (value: string) => void;
  agentLabel: string;
  selectedAgent: string | null;
  agentPickerOpen: boolean;
  agentPickerBusy: boolean;
  agentPickerError: string | null;
  agentOptions: Agent[];
  onToggleAgentPicker: () => void;
  onSelectAgent: (agent: string | null) => void;
  setAgentPickerRef: (el: HTMLDivElement) => void;
  showNotionBanner: boolean;
  onNotionBannerClick: () => void;
  toast: string | null;
  onToast: (message: string) => void;
  listAgents: () => Promise<Agent[]>;
  recentFiles: string[];
  searchFiles: (query: string) => Promise<string[]>;
  isRemoteWorkspace: boolean;
  attachmentsEnabled: boolean;
  attachmentsDisabledReason: string | null;
};

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const ACCEPTED_FILE_TYPES = [...ACCEPTED_IMAGE_TYPES, "application/pdf"];

const isImageMime = (mime: string) => ACCEPTED_IMAGE_TYPES.includes(mime);

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read attachment"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result);
    };
    reader.readAsDataURL(file);
  });

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeText = (value: string) => value.replace(/\u00a0/g, " ");

const MODEL_VARIANT_OPTIONS = [
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "X-High" },
];

const partsToText = (parts: ComposerPart[]) =>
  parts
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "agent") return `@${part.name}`;
      return `@${part.label ?? part.path}`;
    })
    .join("");

const createMentionSpan = (part: Extract<ComposerPart, { type: "agent" | "file" }>) => {
  const span = document.createElement("span");
  const label = part.type === "agent" ? part.name : part.label ?? part.path;
  span.textContent = `@${label}`;
  span.contentEditable = "false";
  span.dataset.mentionKind = part.type;
  span.dataset.mentionValue = part.type === "agent" ? part.name : part.path;
  span.dataset.mentionLabel = label;
  span.className =
    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-dls-active text-dls-text border border-dls-border";
  return span;
};

const insertTextWithBreaks = (target: HTMLElement, text: string) => {
  const chunks = text.split("\n");
  chunks.forEach((chunk, index) => {
    if (chunk.length) {
      target.appendChild(document.createTextNode(chunk));
    }
    if (index < chunks.length - 1) {
      target.appendChild(document.createElement("br"));
    }
  });
};

const buildPartsFromEditor = (root: HTMLElement): ComposerPart[] => {
  const parts: ComposerPart[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last?.type === "text") {
      last.text += text;
      return;
    }
    parts.push({ type: "text", text });
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.dataset.mentionKind) {
      const kind = el.dataset.mentionKind === "agent" ? "agent" : "file";
      if (kind === "agent") {
        parts.push({ type: "agent", name: el.dataset.mentionValue ?? "" });
      } else {
        parts.push({ type: "file", path: el.dataset.mentionValue ?? "", label: el.dataset.mentionLabel ?? undefined });
      }
      return;
    }
    if (el.tagName === "BR") {
      pushText("\n");
      return;
    }
    if (el.tagName === "DIV") {
      if (!el.childNodes.length) {
        pushText("\n");
        return;
      }
      el.childNodes.forEach(walk);
      pushText("\n");
      return;
    }
    el.childNodes.forEach(walk);
  };

  root.childNodes.forEach(walk);
  return parts;
};

const getSelectionOffsets = (root: HTMLElement) => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const startRange = range.cloneRange();
  startRange.selectNodeContents(root);
  startRange.setEnd(range.startContainer, range.startOffset);
  const endRange = range.cloneRange();
  endRange.selectNodeContents(root);
  endRange.setEnd(range.endContainer, range.endOffset);
  return {
    start: startRange.toString().length,
    end: endRange.toString().length,
  };
};

const restoreSelectionOffsets = (root: HTMLElement, offsets: { start: number; end: number }) => {
  const selection = window.getSelection();
  if (!selection) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node: Node | null;
  let current = 0;
  let startNode: Node | null = null;
  let endNode: Node | null = null;
  let startOffset = 0;
  let endOffset = 0;

  while ((node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0;
    if (!startNode && current + length >= offsets.start) {
      startNode = node;
      startOffset = offsets.start - current;
    }
    if (!endNode && current + length >= offsets.end) {
      endNode = node;
      endOffset = offsets.end - current;
      break;
    }
    current += length;
  }

  const range = document.createRange();
  if (!startNode || !endNode) {
    range.selectNodeContents(root);
    range.collapse(false);
  } else {
    range.setStart(startNode, clamp(startOffset, 0, (startNode.textContent ?? "").length));
    range.setEnd(endNode, clamp(endOffset, 0, (endNode.textContent ?? "").length));
  }
  selection.removeAllRanges();
  selection.addRange(range);
};

const buildRangeFromOffsets = (root: HTMLElement, start: number, end: number) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node: Node | null;
  let current = 0;
  let startNode: Node | null = null;
  let endNode: Node | null = null;
  let startOffset = 0;
  let endOffset = 0;

  while ((node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0;
    if (!startNode && current + length >= start) {
      startNode = node;
      startOffset = start - current;
    }
    if (!endNode && current + length >= end) {
      endNode = node;
      endOffset = end - current;
      break;
    }
    current += length;
  }

  const range = document.createRange();
  if (!startNode || !endNode) {
    range.selectNodeContents(root);
    range.collapse(false);
    return range;
  }
  range.setStart(startNode, clamp(startOffset, 0, (startNode.textContent ?? "").length));
  range.setEnd(endNode, clamp(endOffset, 0, (endNode.textContent ?? "").length));
  return range;
};

export default function Composer(props: ComposerProps) {
  let editorRef: HTMLDivElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  let variantPickerRef: HTMLDivElement | undefined;
  let mentionSearchRun = 0;
  let suppressPromptSync = false;
  const [mentionIndex, setMentionIndex] = createSignal(0);
  const [mentionQuery, setMentionQuery] = createSignal("");
  const [mentionOpen, setMentionOpen] = createSignal(false);
  const [agentOptions, setAgentOptions] = createSignal<Agent[]>([]);
  const [agentLoaded, setAgentLoaded] = createSignal(false);
  const [searchResults, setSearchResults] = createSignal<string[]>([]);
  const [searchLoading, setSearchLoading] = createSignal(false);
  const [attachments, setAttachments] = createSignal<ComposerAttachment[]>([]);
  const [mode, setMode] = createSignal<PromptMode>("prompt");
  const [historySnapshot, setHistorySnapshot] = createSignal<ComposerDraft | null>(null);
  const [historyIndex, setHistoryIndex] = createSignal({ prompt: -1, shell: -1 });
  const [history, setHistory] = createSignal({ prompt: [] as ComposerDraft[], shell: [] as ComposerDraft[] });
  const [variantMenuOpen, setVariantMenuOpen] = createSignal(false);
  const activeVariant = createMemo(() => props.modelVariant ?? "none");
  const attachmentsDisabled = createMemo(() => !props.attachmentsEnabled);

  onMount(() => {
    queueMicrotask(() => focusEditorEnd());
  });

  createEffect(() => {
    if (mentionOpen()) {
      mentionQuery(); setMentionIndex(0);
    }
  });

  const mentionSections = createMemo<MentionSection[]>(() => {
    if (!mentionOpen()) return [];
    const query = mentionQuery().trim().toLowerCase();
    const agents = agentOptions()
      .filter((agent: Agent) => {
        if (!query) return true;
        return agent.name.toLowerCase().includes(query);
      })
      .map((agent: Agent) => ({
        id: `agent:${agent.name}`,
        kind: "agent" as const,
        label: agent.name,
        value: agent.name,
      }));

    const recentFiles = props.recentFiles
      .filter((file: string) => {
        if (!query) return true;
        return file.toLowerCase().includes(query);
      })
      .map((file: string) => ({
        id: `file:${file}`,
        kind: "file" as const,
        label: file.split(/[/\\]/).pop() ?? file,
        value: file,
        detail: file,
      }));

    const searchFiles = searchResults()
      .filter((file: string) => file && !recentFiles.find((recent) => recent.value === file))
      .map((file: string) => ({
        id: `search:${file}`,
        kind: "file" as const,
        label: file.split(/[/\\]/).pop() ?? file,
        value: file,
        detail: file,
      }));

    const sections: MentionSection[] = [];
    if (agents.length) sections.push({ title: "Agents", options: agents });
    if (recentFiles.length) sections.push({ title: "Recent files", options: recentFiles });
    if (searchFiles.length) sections.push({ title: "Search results", options: searchFiles });
    if (!searchFiles.length && query) {
      sections.push({
        title: "Use path",
        options: [
          {
            id: `manual:${query}`,
            kind: "file",
            label: query.split(/[/\\]/).pop() ?? query,
            value: query,
            detail: query,
          },
        ],
      });
    }
    return sections;
  });

  const mentionOptions = createMemo(() =>
    mentionSections().flatMap((section: MentionSection) => section.options)
  );

  const syncHeight = () => {
    if (!editorRef) return;
    editorRef.style.height = "auto";
    const baseHeight = 24;
    const scrollHeight = editorRef.scrollHeight || baseHeight;
    const nextHeight = Math.min(Math.max(scrollHeight, baseHeight), 160);
    editorRef.style.height = `${nextHeight}px`;
    editorRef.style.overflowY = editorRef.scrollHeight > 160 ? "auto" : "hidden";
  };

  const emitDraftChange = () => {
    if (!editorRef) return;
    const parts = buildPartsFromEditor(editorRef);
    const text = normalizeText(partsToText(parts));
    suppressPromptSync = true;
    props.onDraftChange({
      mode: mode(),
      parts,
      attachments: attachments(),
      text,
    });
    queueMicrotask(() => {
      suppressPromptSync = false;
    });
    syncHeight();
  };

  const focusEditorEnd = () => {
    if (!editorRef) return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(editorRef);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    editorRef.focus();
  };

  const renderParts = (parts: ComposerPart[], keepSelection = true) => {
    if (!editorRef) return;
    const selection = keepSelection ? getSelectionOffsets(editorRef) : null;
    editorRef.innerHTML = "";
    parts.forEach((part) => {
      if (part.type === "text") {
        insertTextWithBreaks(editorRef!, part.text);
        return;
      }
      const span = createMentionSpan(part);
      editorRef?.appendChild(span);
      editorRef?.appendChild(document.createTextNode(" "));
    });
    if (selection) {
      restoreSelectionOffsets(editorRef, selection);
    }
    syncHeight();
  };

  const setEditorText = (value: string) => {
    if (!editorRef) return;
    renderParts(value ? [{ type: "text", text: value }] : [], false);
  };

  const updateMentionQuery = () => {
    if (!editorRef) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      setMentionOpen(false);
      return;
    }
    const range = selection.getRangeAt(0);
    const beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(editorRef);
    beforeRange.setEnd(range.endContainer, range.endOffset);
    const beforeText = normalizeText(beforeRange.toString());
    const atIndex = beforeText.lastIndexOf("@");
    if (atIndex === -1) {
      setMentionOpen(false);
      return;
    }
    const query = beforeText.slice(atIndex + 1);
    if (/\s/.test(query)) {
      setMentionOpen(false);
      return;
    }
    setMentionQuery(query);
    setMentionOpen(true);
  };

  const insertMention = (option: MentionOption) => {
    if (!editorRef) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(editorRef);
    beforeRange.setEnd(range.endContainer, range.endOffset);
    const beforeText = normalizeText(beforeRange.toString());
    const atIndex = beforeText.lastIndexOf("@");
    if (atIndex === -1) return;
    const start = atIndex;
    const end = beforeText.length;
    const deleteRange = buildRangeFromOffsets(editorRef, start, end);
    deleteRange.deleteContents();

    const mentionPart =
      option.kind === "agent"
        ? ({ type: "agent", name: option.value } as ComposerPart)
        : ({ type: "file", path: option.value, label: option.label } as ComposerPart);
    const mentionNode = createMentionSpan(mentionPart as Extract<ComposerPart, { type: "agent" | "file" }>);
    deleteRange.insertNode(mentionNode);
    mentionNode.after(document.createTextNode(" "));

    const cursor = document.createRange();
    cursor.setStartAfter(mentionNode.nextSibling ?? mentionNode);
    cursor.collapse(true);
    selection.removeAllRanges();
    selection.addRange(cursor);
    setMentionOpen(false);
    setMentionQuery("");
    emitDraftChange();
  };

  const canNavigateHistory = () => {
    if (!editorRef) return false;
    const offsets = getSelectionOffsets(editorRef);
    if (!offsets || offsets.start !== offsets.end) return false;
    const total = normalizeText(editorRef.innerText).length;
    return offsets.start === 0 || offsets.start === total;
  };

  const applyHistoryDraft = (draft: ComposerDraft | null) => {
    if (!draft) return;
    setMode(draft.mode);
    renderParts(draft.parts, false);
    setAttachments(draft.attachments ?? []);
    props.onDraftChange(draft);
  };

  const navigateHistory = (direction: "up" | "down") => {
    const key = mode();
    const list = history()[key];
    if (!list.length) return;
    const index = historyIndex()[key];
    const nextIndex = direction === "up" ? index + 1 : index - 1;
    if (nextIndex < -1 || nextIndex >= list.length) return;

    if (index === -1 && direction === "up") {
      const parts = editorRef ? buildPartsFromEditor(editorRef) : [];
      const text = normalizeText(partsToText(parts));
      setHistorySnapshot({ mode: key, parts, attachments: attachments(), text });
    }

    setHistoryIndex((current: { prompt: number; shell: number }) => ({ ...current, [key]: nextIndex }));
    if (nextIndex === -1) {
      applyHistoryDraft(historySnapshot());
      setHistorySnapshot(null);
      return;
    }
    const target = list[list.length - 1 - nextIndex];
    applyHistoryDraft(target);
  };

  const sendDraft = () => {
    if (!editorRef) return;
    const parts = buildPartsFromEditor(editorRef);
    const text = normalizeText(partsToText(parts));
    const draft: ComposerDraft = { mode: mode(), parts, attachments: attachments(), text };
    recordHistory(draft);
    props.onSend(draft);
    setAttachments([]);
    setEditorText("");
    emitDraftChange();
    queueMicrotask(() => focusEditorEnd());
  };

  const recordHistory = (draft: ComposerDraft) => {
    const trimmed = draft.text.trim();
    if (!trimmed && !draft.attachments.length) return;
    setHistory((current: { prompt: ComposerDraft[]; shell: ComposerDraft[] }) => ({
      ...current,
      [draft.mode]: [...current[draft.mode], { ...draft, attachments: [] }],
    }));
    setHistoryIndex((current: { prompt: number; shell: number }) => ({ ...current, [draft.mode]: -1 }));
    setHistorySnapshot(null);
  };

  const addAttachments = async (files: File[]) => {
    if (attachmentsDisabled()) {
      props.onToast(props.attachmentsDisabledReason ?? "Attachments are unavailable.");
      return;
    }
    const next: ComposerAttachment[] = [];
    for (const file of files) {
      if (!ACCEPTED_FILE_TYPES.includes(file.type)) {
        props.onToast(`${file.name} is not a supported attachment type.`);
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        props.onToast(`${file.name} exceeds the 8MB limit.`);
        continue;
      }
      try {
        const dataUrl = await fileToDataUrl(file);
        next.push({
          id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          kind: isImageMime(file.type) ? "image" : "file",
          dataUrl,
        });
      } catch (error) {
        props.onToast(error instanceof Error ? error.message : "Failed to read attachment");
      }
    }
    if (next.length) {
      setAttachments((current: ComposerAttachment[]) => [...current, ...next]);
      emitDraftChange();
    }
  };

  const handlePaste = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    const clipboard = event.clipboardData;
    const fileItems = Array.from(clipboard.items || []).filter((item) => item.kind === "file");
    const files = Array.from(clipboard.files || []);
    const itemFiles = fileItems
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);
    const allFiles = files.length ? files : itemFiles;
    if (!allFiles.length) return;
    event.preventDefault();
    const hasSupported = allFiles.some((file) => ACCEPTED_FILE_TYPES.includes(file.type));
    if (!hasSupported) {
      props.onToast("Unsupported attachment type.");
      return;
    }
    void addAttachments(allFiles);
  };

  const handleDrop = (event: DragEvent) => {
    if (!event.dataTransfer) return;
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length) void addAttachments(files);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      document.execCommand("insertLineBreak");
      emitDraftChange();
      return;
    }
    if (event.isComposing && event.key !== "Enter") return;

    if (mentionOpen()) {
      const options = mentionOptions();
      if (event.key === "Enter") {
        event.preventDefault();
        const active = options[mentionIndex()] ?? options[0];
        if (active) insertMention(active);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((i: number) => clamp(i + 1, 0, options.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((i: number) => clamp(i - 1, 0, options.length - 1));
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionOpen(false);
        setMentionQuery("");
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const active = options[mentionIndex()] ?? options[0];
        if (active) insertMention(active);
        return;
      }
    }

    if (event.key === "!" && mode() === "prompt") {
      const offsets = editorRef ? getSelectionOffsets(editorRef) : null;
      if (offsets && offsets.start === 0 && offsets.end === 0) {
        event.preventDefault();
        setMode("shell");
        emitDraftChange();
        return;
      }
    }

    if (event.key === "Escape" && mode() === "shell") {
      event.preventDefault();
      setMode("prompt");
      emitDraftChange();
      return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (canNavigateHistory()) {
        event.preventDefault();
        navigateHistory(event.key === "ArrowUp" ? "up" : "down");
        return;
      }
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (props.busy) return;
      sendDraft();
    }
  };

  createEffect(() => {
    if (!mentionOpen() || agentLoaded()) return;
    props
      .listAgents()
      .then((agents) => setAgentOptions(agents))
      .catch(() => setAgentOptions([]))
      .finally(() => setAgentLoaded(true));
  });

  createEffect(() => {
    if (!mentionOpen()) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    const query = mentionQuery().trim();
    if (!query) {
      setSearchResults([]);
      return;
    }
    const runId = (mentionSearchRun += 1);
    setSearchLoading(true);
    const timeout = window.setTimeout(() => {
      props
        .searchFiles(query)
        .then((results) => {
          if (runId !== mentionSearchRun) return;
          setSearchResults(results);
        })
        .catch(() => {
          if (runId !== mentionSearchRun) return;
          setSearchResults([]);
        })
        .finally(() => {
          if (runId !== mentionSearchRun) return;
          setSearchLoading(false);
        });
    }, 150);
    onCleanup(() => {
      window.clearTimeout(timeout);
      if (runId === mentionSearchRun) {
        setSearchLoading(false);
      }
    });
  });

  createEffect(() => {
    if (!editorRef) return;
    const value = props.prompt;
    const current = normalizeText(editorRef.innerText);
    if (suppressPromptSync) {
      if (!value && current) {
        setEditorText("");
        setAttachments([]);
        setHistoryIndex((currentIndex: { prompt: number; shell: number }) => ({ ...currentIndex, [mode()]: -1 }));
        setHistorySnapshot(null);
        queueMicrotask(() => focusEditorEnd());
      }
      return;
    }
    if (value === current) return;
    if (value.startsWith("!") && mode() === "prompt") {
      setMode("shell");
      setEditorText(value.slice(1).trimStart());
      emitDraftChange();
      queueMicrotask(() => focusEditorEnd());
      return;
    }
    setEditorText(value);
    if (!value) {
      setAttachments([]);
      setHistoryIndex((currentIndex: { prompt: number; shell: number }) => ({ ...currentIndex, [mode()]: -1 }));
      setHistorySnapshot(null);
    }
    emitDraftChange();
    queueMicrotask(() => focusEditorEnd());
  });

  createEffect(() => {
    if (!variantMenuOpen()) return;
    const handler = (event: MouseEvent) => {
      if (!variantPickerRef) return;
      if (variantPickerRef.contains(event.target as Node)) return;
      setVariantMenuOpen(false);
    };
    window.addEventListener("mousedown", handler);
    onCleanup(() => window.removeEventListener("mousedown", handler));
  });

  createEffect(() => {
    const handler = () => {
      editorRef?.focus();
    };
    window.addEventListener("openwork:focusPrompt", handler);
    onCleanup(() => window.removeEventListener("openwork:focusPrompt", handler));
  });

  return (
    <div class="px-4 pb-4 pt-0 bg-dls-surface sticky bottom-0 z-20">
      <div class="max-w-3xl mx-auto">
        <div
          class={`bg-dls-surface border border-dls-border rounded-2xl shadow-xl overflow-visible transition-all relative group/input ${
            mentionOpen() ? "rounded-t-none border-t-transparent" : ""
          }`}
          onDrop={handleDrop}
          onDragOver={(event: DragEvent) => {
            if (attachmentsDisabled()) return;
            event.preventDefault();
          }}
        >
          <Show when={mentionOpen()}>
            <div class="absolute bottom-full left-[-1px] right-[-1px] z-30">
              <div class="rounded-t-3xl border border-dls-border border-b-0 bg-dls-surface shadow-2xl overflow-hidden">
                <div class="px-4 pt-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-dls-secondary border-b border-dls-border bg-dls-surface flex items-center gap-2">
                  <AtSign size={12} />
                  Mentions
                </div>
                <div class="space-y-3 p-3 bg-dls-surface max-h-64 overflow-y-auto">
                  <Show
                    when={mentionOptions().length}
                    fallback={
                      <div class="px-3 py-2 text-xs text-dls-secondary">
                        {searchLoading() ? "Searching files..." : "No matches found."}
                      </div>
                    }
                  >
                    <For each={mentionSections()}>
                      {(section: MentionSection) => (
                        <div>
                          <div class="px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-dls-secondary">
                            {section.title}
                          </div>
                          <div class="space-y-1">
                            <For each={section.options}>
                              {(option: MentionOption) => {
                                const optionIndex = createMemo(() => mentionOptions().findIndex((item) => item.id === option.id));
                                return (
                                  <button
                                    type="button"
                                    class={`w-full flex items-start gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                                      optionIndex() === mentionIndex()
                                        ? "bg-dls-active text-dls-text"
                                        : "text-dls-text hover:bg-dls-hover"
                                    }`}
                                    onMouseDown={(e: MouseEvent) => {
                                      e.preventDefault();
                                      insertMention(option);
                                    }}
                                    onMouseEnter={() => setMentionIndex(optionIndex())}
                                  >
                                    <div class="text-xs font-semibold text-dls-text">
                                      {option.kind === "agent" ? `@${option.label}` : option.label}
                                    </div>
                                    <Show when={option.detail}>
                                      <div class="text-[11px] text-dls-secondary">{option.detail}</div>
                                    </Show>
                                  </button>
                                );
                              }}
                            </For>
                          </div>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </div>
            </div>
          </Show>

          <div class="hidden">
            <button
              type="button"
              class="flex items-center gap-1.5 text-gray-7 hover:text-gray-11 transition-colors"
              onClick={props.onModelClick}
              disabled={props.busy}
            >
              <Zap size={10} class="text-gray-7 group-hover:text-amber-11 transition-colors" />
              <span>{props.selectedModelLabel}</span>
            </button>
            <div class="relative z-40" ref={(el) => (variantPickerRef = el)}>
              <button
                type="button"
                class="flex items-center gap-2 rounded-full border border-gray-6/80 bg-gray-1/60 px-2 py-0.5 text-[9px] text-gray-9 hover:text-gray-11 hover:border-gray-7 transition-colors"
                onClick={() => setVariantMenuOpen((open) => !open)}
                disabled={props.busy}
                aria-expanded={variantMenuOpen()}
              >
                <span class="text-gray-8">Variant</span>
                <span class="font-mono text-gray-11">{props.modelVariantLabel}</span>
                <ChevronDown size={12} class="text-gray-8" />
              </button>
              <Show when={variantMenuOpen()}>
                <div class="absolute left-0 bottom-full mb-2 w-40 rounded-2xl border border-gray-6 bg-gray-1/95 shadow-2xl backdrop-blur-md overflow-hidden z-40">
                  <div class="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-8 border-b border-gray-6/30">
                    Thinking effort
                  </div>
                  <div class="p-2 space-y-1">
                    <For each={MODEL_VARIANT_OPTIONS}>
                      {(option) => (
                        <button
                          type="button"
                          class={`w-full flex items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                            activeVariant() === option.value
                              ? "bg-gray-12/10 text-gray-12"
                              : "text-gray-11 hover:bg-gray-12/5"
                          }`}
                          onClick={() => {
                            props.onModelVariantChange(option.value);
                            setVariantMenuOpen(false);
                          }}
                        >
                          <span>{option.label}</span>
                          <Show when={activeVariant() === option.value}>
                            <span class="text-[10px] uppercase tracking-wider text-gray-9">Active</span>
                          </Show>
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          </div>

          <div class="p-3 px-4">
            <Show when={props.showNotionBanner}>
              <button
                type="button"
                class="w-full mb-2 flex items-center justify-between gap-3 rounded-xl border border-green-7/20 bg-green-7/10 px-3 py-2 text-left text-sm text-green-12 transition-colors hover:bg-green-7/15"
                onClick={props.onNotionBannerClick}
              >
                <span>Try it now: set up my CRM in Notion</span>
                <span class="text-xs text-green-12 font-medium">Insert prompt</span>
              </button>
            </Show>

            <Show when={attachments().length}>
              <div class="mb-3 flex flex-wrap gap-2">
                <For each={attachments()}>
                  {(attachment: ComposerAttachment) => (
                    <div class="flex items-center gap-2 rounded-2xl border border-dls-border bg-dls-hover px-3 py-2 text-xs text-dls-secondary">
                      <Show
                        when={attachment.kind === "image"}
                        fallback={<File size={14} class="text-dls-secondary" />}
                      >
                        <div class="h-10 w-10 rounded-xl bg-dls-surface overflow-hidden border border-dls-border">
                          <img src={attachment.dataUrl} alt={attachment.name} class="h-full w-full object-cover" />
                        </div>
                      </Show>
                      <div class="max-w-[160px]">
                        <div class="truncate text-dls-text">{attachment.name}</div>
                        <div class="text-[10px] text-dls-secondary">
                          {attachment.kind === "image" ? "Image" : attachment.mimeType || "File"}
                        </div>
                      </div>
                      <button
                        type="button"
                        class="ml-1 rounded-full p-1 text-dls-secondary hover:text-dls-text hover:bg-dls-active"
                        onClick={() => {
                          setAttachments((current: ComposerAttachment[]) =>
                            current.filter((item) => item.id !== attachment.id)
                          );
                          emitDraftChange();
                        }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>

                   <div class="relative min-h-[120px]">
              <Show when={props.toast}>
                <div class="absolute bottom-full right-0 mb-2 z-30 rounded-xl border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-secondary shadow-lg backdrop-blur-md">
                  {props.toast}
                </div>
              </Show>

              <div class="flex flex-col gap-2">
                <div class="flex-1 min-w-0">
                  <Show when={props.isRemoteWorkspace}>
                    <div class="mb-2 text-[10px] uppercase tracking-wider text-dls-secondary">Remote workspace</div>
                  </Show>

                  <div class="relative">
                    <Show when={!props.prompt.trim() && !attachments().length}>
                      <div class="absolute left-0 top-0 text-dls-secondary text-sm leading-relaxed pointer-events-none">
                        Ask OpenWork...
                      </div>
                    </Show>
                    <div
                      ref={editorRef}
                      contentEditable={true}
                      role="textbox"
                      aria-multiline="true"
                      onInput={() => {
                        updateMentionQuery();
                        emitDraftChange();
                      }}
                      onKeyDown={handleKeyDown}
                      onKeyUp={updateMentionQuery}
                      onClick={updateMentionQuery}
                      onPaste={handlePaste}
                      class="bg-transparent border-none p-0 pb-8 pr-4 text-dls-text focus:ring-0 text-sm leading-relaxed resize-none min-h-[24px] outline-none relative z-10"
                    />

                    <div class="mt-3 flex items-center justify-between px-2 pb-2">
                      <div class="flex items-center gap-2">
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept={ACCEPTED_FILE_TYPES.join(",")}
                          class="hidden"
                          disabled={attachmentsDisabled()}
                          onChange={(event: Event) => {
                            const target = event.currentTarget as HTMLInputElement;
                            const files = Array.from(target.files ?? []);
                            if (files.length) void addAttachments(files);
                            target.value = "";
                          }}
                        />
                        <button
                          type="button"
                          class={`p-1.5 hover:bg-dls-hover rounded-md text-dls-secondary transition-colors ${
                            attachmentsDisabled() ? "cursor-not-allowed" : ""
                          }`}
                          onClick={() => {
                            if (attachmentsDisabled()) return;
                            fileInputRef?.click();
                          }}
                          disabled={attachmentsDisabled()}
                          title={
                            attachmentsDisabled()
                              ? props.attachmentsDisabledReason ?? "Attachments are unavailable."
                              : "Attach files"
                          }
                        >
                          <Paperclip size={16} />
                        </button>
                        <button
                          type="button"
                          class="flex items-center gap-1.5 px-2 py-1 hover:bg-dls-hover rounded-md text-xs font-medium text-dls-secondary hover:text-dls-text"
                          onClick={props.onModelClick}
                          disabled={props.busy}
                        >
                          {props.selectedModelLabel}
                          <ChevronDown size={14} />
                        </button>
                      </div>
                      <div class="flex items-center gap-3 text-dls-secondary">
                        <button type="button" class="cursor-pointer hover:text-dls-text">
                          <History size={18} />
                        </button>
                        <button type="button" class="cursor-pointer hover:text-dls-text">
                          <Mic size={18} />
                        </button>
                        <button
                          type="button"
                          disabled={!props.prompt.trim() && !attachments().length}
                          onClick={sendDraft}
                          class={`p-1.5 rounded-full ${
                            !props.prompt.trim() && !attachments().length
                              ? "bg-dls-active text-dls-secondary"
                              : "bg-dls-accent text-white"
                          }`}
                          title="Send"
                        >
                          <ArrowUp size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
