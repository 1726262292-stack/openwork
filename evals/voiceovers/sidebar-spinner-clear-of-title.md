# sidebar-spinner-clear-of-title — The sidebar spinner never covers the task name

While a task runs, its sidebar row shows a small spinner. A class-precedence bug dropped the row's end padding exactly in the streaming state, so long task names ran underneath the spinner and the two rendered on top of each other. This proof runs a real task and measures the row.

1. Alex kicks off a task and the sidebar row shows a spinner while the agent works.

2. Even with a long task name, the title now truncates before the spinner instead of running underneath it — the spinner never covers the letters.

3. When the run finishes, the spinner clears and the row reads normally again.
