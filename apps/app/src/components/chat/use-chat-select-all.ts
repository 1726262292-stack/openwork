import { useEffect } from "react"

declare global {
  interface Window {
    __openworkChatSelectAll?: () => boolean
  }
}

let mountedTranscriptCount = 0

function isEditableElement(element: Element | null) {
  if (!element) return false

  return element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || Boolean(element.closest('[contenteditable="true"]'))
}

function isVisible(element: Element) {
  return element.getBoundingClientRect().width > 0
}

function findTranscriptRoot(activeElement: Element | null) {
  const containingRoot = activeElement?.closest("[data-chat-transcript]")

  if (containingRoot) {
    return containingRoot
  }

  for (const root of document.querySelectorAll("[data-chat-transcript]")) {
    if (isVisible(root)) {
      return root
    }
  }

  return null
}

function isSelectAllShortcut(event: KeyboardEvent) {
  return (event.metaKey || event.ctrlKey)
    && !event.shiftKey
    && !event.altKey
    && event.key.toLowerCase() === "a"
}

export function scopedChatSelectAll(): boolean {
  const activeElement = document.activeElement

  if (isEditableElement(activeElement)) {
    return false
  }

  const root = findTranscriptRoot(activeElement)

  if (!root) {
    return false
  }

  const selection = window.getSelection()

  if (!selection) {
    return false
  }

  selection.removeAllRanges()
  const range = document.createRange()
  range.selectNodeContents(root)
  selection.addRange(range)

  return true
}

export function useChatSelectAll() {
  useEffect(() => {
    mountedTranscriptCount += 1
    window.__openworkChatSelectAll = scopedChatSelectAll

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isSelectAllShortcut(event)) {
        return
      }

      if (scopedChatSelectAll()) {
        event.preventDefault()
      }
    }

    document.addEventListener("keydown", onKeyDown, true)

    return () => {
      mountedTranscriptCount -= 1
      document.removeEventListener("keydown", onKeyDown, true)

      if (mountedTranscriptCount === 0 && window.__openworkChatSelectAll === scopedChatSelectAll) {
        delete window.__openworkChatSelectAll
      }
    }
  }, [])
}
