# chat-first-onboarding — First run lands in a chat; folders happen for you

Screens 04–06 of the Cloud Welcome onboarding rethink. Flag-gated (default
off; the demo runs with it on). The welcome screen drops the folder decision,
first run lands in a chat empty state, and a small dialog is the only override
surface. A chat-folder is a real workspace under ~/OpenWork/chats/ — created
BEFORE OpenCode binds to it, resolved via the platform home APIs, never
hand-built path strings. The previous two attempts at auto-workspaces died on
a create/connect race and on hand-rolled cross-platform paths; this step fixes
both by contract: create folder → verify → init workspace → connect session.

1. I open OpenWork for the first time and nobody asks me about folders — the steps read Chat, Review, Reuse, and the button just says "Start chatting"; a quiet line underneath tells me chats are saved in ~/OpenWork, with a "Change location" link if I ever care.

2. I click "Start chatting" and land straight in a chat — "What do you need done?" — with a composer and four suggestions: summarize my week, clean up a spreadsheet, draft a document, automate a web task.

3. At the bottom of the chat, a whisper says where this chat lives — a folder OpenWork created for me under ~/OpenWork/chats. I never saw a file dialog.

4. I send my first message and the work just starts — by the time the agent speaks, this chat's folder already exists on disk, so there's no setup screen and no race to lose.

5. When I click "Change location", a small dialog offers the recommended automatic default or a custom folder with Browse — Cancel or Save, and that's the whole decision.

6. And when a chat belongs inside a real project, "Use a specific folder" points just this chat at my existing directory — today's folder picker, demoted to the power-user path.
