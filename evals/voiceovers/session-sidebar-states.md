# session-sidebar-states — A distinct sidebar that hides without losing context

1. The sessions sidebar is a solid, contained panel on every platform, with no macOS translucency or platform-specific visual treatment.

2. The selected, loading, and unread session states remain aligned and readable, even when the sidebar is resized to its narrowest supported width.

3. When I hide the sidebar, the entire panel glides offscreen without squeezing or rewrapping its contents, while the conversation expands using the same timing and easing.

4. The header, tabs, and conversation move together as one surface, with no traffic-light padding jump or mismatched animation.

5. A subtle edge affordance and the existing sidebar control let me reopen it, restoring the same selected session, scroll position, groups, and sidebar width.

6. Dragging the sidebar width stays immediate rather than animated, and hiding it during or after resize never leaves a stale gap.

7. With reduced motion enabled, the same hide and reopen behavior happens instantly without losing state.
