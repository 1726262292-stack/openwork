import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  type Accessor,
  type JSX,
} from "solid-js";

const STREAM_SCROLL_MIN_INTERVAL_MS = 90;
const FOLLOW_LATEST_BOTTOM_GAP_PX = 96;

type SessionScrollMode = "follow-latest" | "manual-browse";

type SessionScrollControllerOptions = {
  selectedSessionId: Accessor<string | null>;
  messageCount: Accessor<number>;
  isContainerReady: Accessor<boolean>;
  renderedMessages: Accessor<unknown>;
  containerRef: Accessor<HTMLDivElement | undefined>;
  messagesEndRef: Accessor<HTMLDivElement | undefined>;
};

export function createSessionScrollController(
  options: SessionScrollControllerOptions,
) {
  const [mode, setMode] = createSignal<SessionScrollMode>("follow-latest");
  const [topClippedMessageId, setTopClippedMessageId] = createSignal<string | null>(null);
  const [initialAnchorPending, setInitialAnchorPending] = createSignal(false);
  const isViewingLatest = createMemo(() => mode() === "follow-latest");

  let scrollFrame: number | undefined;
  let pendingScrollBehavior: ScrollBehavior = "auto";
  let lastAutoScrollAt = 0;
  let lastKnownScrollTop = 0;
  let initialAnchorRafA: number | undefined;
  let initialAnchorRafB: number | undefined;
  let initialAnchorGuardTimer: ReturnType<typeof setTimeout> | undefined;

  const scrollToLatest = (behavior: ScrollBehavior = "auto") => {
    options.messagesEndRef()?.scrollIntoView({ behavior, block: "end" });
  };

  const refreshTopClippedMessage = () => {
    const container = options.containerRef();
    if (!container) {
      setTopClippedMessageId(null);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const messageEls = container.querySelectorAll("[data-message-id]");
    const latestMessageEl = messageEls[messageEls.length - 1] as HTMLElement | undefined;
    const latestMessageId = latestMessageEl?.getAttribute("data-message-id")?.trim() ?? "";
    let nextId: string | null = null;

    for (const node of messageEls) {
      const el = node as HTMLElement;
      const rect = el.getBoundingClientRect();
      if (rect.bottom <= containerRect.top + 1) continue;
      if (rect.top >= containerRect.bottom - 1) break;

      if (rect.top < containerRect.top - 1) {
        const id = el.getAttribute("data-message-id")?.trim() ?? "";
        if (id) {
          const isLatestMessage = id === latestMessageId;
          const fillsViewportTail = rect.bottom >= containerRect.bottom - 1;
          if (isLatestMessage || fillsViewportTail) {
            nextId = id;
          }
        }
      }
      break;
    }

    setTopClippedMessageId(nextId);
  };

  const pinToLatestNow = () => {
    setMode("follow-latest");
    scrollToLatest("auto");
  };

  const pinToLatestAfterLayout = () => {
    setMode("follow-latest");
    setTopClippedMessageId(null);
    scrollToLatest("auto");
    queueMicrotask(() => {
      scrollToLatest("auto");
    });
    window.requestAnimationFrame(() => {
      scrollToLatest("auto");
      window.requestAnimationFrame(() => {
        pinToLatestNow();
      });
    });
  };

  const scheduleScrollToLatest = (behavior: ScrollBehavior = "auto") => {
    if (!isViewingLatest()) return;
    if (behavior === "smooth") {
      pendingScrollBehavior = "smooth";
    }
    if (scrollFrame !== undefined) return;
    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = undefined;
      const nextBehavior = pendingScrollBehavior;
      pendingScrollBehavior = "auto";
      const now = Date.now();
      if (
        nextBehavior === "auto" &&
        now - lastAutoScrollAt < STREAM_SCROLL_MIN_INTERVAL_MS
      ) {
        return;
      }
      lastAutoScrollAt = now;
      scrollToLatest(nextBehavior);
    });
  };

  const cancelInitialAnchorFrames = () => {
    if (initialAnchorRafA !== undefined) {
      window.cancelAnimationFrame(initialAnchorRafA);
      initialAnchorRafA = undefined;
    }
    if (initialAnchorRafB !== undefined) {
      window.cancelAnimationFrame(initialAnchorRafB);
      initialAnchorRafB = undefined;
    }
    if (initialAnchorGuardTimer) {
      clearTimeout(initialAnchorGuardTimer);
      initialAnchorGuardTimer = undefined;
    }
  };

  const applyInitialBottomAnchor = (sessionId: string) => {
    cancelInitialAnchorFrames();
    initialAnchorGuardTimer = setTimeout(() => {
      initialAnchorGuardTimer = undefined;
      if (options.selectedSessionId() !== sessionId) return;
      setInitialAnchorPending(false);
    }, 200);
    pinToLatestNow();
    initialAnchorRafA = window.requestAnimationFrame(() => {
      initialAnchorRafA = undefined;
      pinToLatestNow();
      initialAnchorRafB = window.requestAnimationFrame(() => {
        initialAnchorRafB = undefined;
        pinToLatestNow();
        if (options.selectedSessionId() !== sessionId) return;
        setInitialAnchorPending(false);
      });
    });
  };

  const handleScroll: JSX.EventHandlerUnion<HTMLDivElement, Event> = (event) => {
    const container = event.currentTarget as HTMLDivElement;
    const bottomGap =
      container.scrollHeight - (container.scrollTop + container.clientHeight);
    if (bottomGap <= FOLLOW_LATEST_BOTTOM_GAP_PX) {
      setMode("follow-latest");
    } else if (container.scrollTop < lastKnownScrollTop - 1) {
      setMode("manual-browse");
    }
    lastKnownScrollTop = container.scrollTop;
    refreshTopClippedMessage();
  };

  const jumpToLatest = (behavior: ScrollBehavior = "smooth") => {
    setMode("follow-latest");
    scheduleScrollToLatest(behavior);
  };

  const jumpToStartOfMessage = (behavior: ScrollBehavior = "smooth") => {
    const messageId = topClippedMessageId();
    const container = options.containerRef();
    if (!messageId || !container) return;

    const escapedId = messageId.replace(/"/g, '\\"');
    const target = container.querySelector(
      `[data-message-id="${escapedId}"]`,
    ) as HTMLElement | null;
    if (!target) return;

    setMode("manual-browse");
    target.scrollIntoView({ behavior, block: "start" });
  };

  const handleRunStarted = () => {
    if (!isViewingLatest()) return;
    pinToLatestAfterLayout();
  };

  const handleStreamProgress = () => {
    if (initialAnchorPending()) return;
    if (!isViewingLatest()) return;
    scheduleScrollToLatest("auto");
  };

  const handleUserSentMessage = () => {
    pinToLatestAfterLayout();
  };

  onMount(() => {
    const container = options.containerRef();
    const sentinel = options.messagesEndRef();
    if (!container || !sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        const atBottom = Boolean(entry?.isIntersecting);
        if (atBottom) {
          setMode("follow-latest");
        }
        refreshTopClippedMessage();
      },
      {
        root: container,
        rootMargin: "0px 0px 96px 0px",
        threshold: 0,
      },
    );

    observer.observe(sentinel);
    onCleanup(() => observer.disconnect());
  });

  createEffect(
    on(
      options.selectedSessionId,
      (sessionId, previousSessionId) => {
        if (sessionId === previousSessionId) {
          return;
        }

        if (!sessionId) return;
        setMode("follow-latest");
        setTopClippedMessageId(null);
        setInitialAnchorPending(true);

        queueMicrotask(() => {
          applyInitialBottomAnchor(sessionId);
        });
      },
    ),
  );

  createEffect(
    on(
      () =>
        [
          options.selectedSessionId(),
          options.messageCount(),
          options.isContainerReady(),
          initialAnchorPending(),
        ] as const,
      ([sessionId, count, ready, pending]) => {
        if (!pending) return;
        if (!sessionId) {
          setInitialAnchorPending(false);
          return;
        }
        if (!ready) return;
        if (count === 0) {
          setInitialAnchorPending(false);
          return;
        }
        queueMicrotask(() => applyInitialBottomAnchor(sessionId));
      },
      { defer: true },
    ),
  );

  createEffect(() => {
    options.renderedMessages();
    initialAnchorPending();
    queueMicrotask(refreshTopClippedMessage);
  });

  onCleanup(() => {
    cancelInitialAnchorFrames();
    if (scrollFrame !== undefined) {
      window.cancelAnimationFrame(scrollFrame);
      scrollFrame = undefined;
    }
  });

  return {
    isViewingLatest,
    topClippedMessageId,
    initialAnchorPending,
    handleScroll,
    handleRunStarted,
    handleStreamProgress,
    handleUserSentMessage,
    jumpToLatest,
    jumpToStartOfMessage,
  };
}
