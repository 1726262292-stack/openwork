# agent-creates-task-via-api — "Create a new task" makes the agent create a real session through the backend API

When Alex asks the agent to create a new task or session, the agent should not puppet the UI — it should call OpenWork's internal API and the new task should simply appear. This proof asks in plain language, watches the agent invoke the new openwork_session_create tool, and confirms the task shows up in the sidebar on its own.

1. Alex opens OpenWork in a workspace and starts from a normal chat.

2. Alex types "Create a new task called Plan the offsite" and sends it.

3. The agent answers by running the openwork_session_create tool — a backend call, not a click-through of the app — and reports the new task.

4. Without Alex touching anything, the sidebar refreshes and "Plan the offsite" is listed as a task in the workspace.

5. Behind the scenes the OpenWork server confirms the session exists with that title, created through the same API any client could call.
