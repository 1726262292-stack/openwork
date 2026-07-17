# chat-user-bubble-selectable — Alex can select the text of their own chat bubbles

User messages render inside a context-menu wrapper that used to disable text selection: dragging the mouse across your own words did nothing, and Select All skipped them. This proof sends a real message and then selects it like any end user would.

1. Alex opens OpenWork and sends a message with a distinctive sentence in it.

2. The sent message appears as Alex's chat bubble, and the bubble now advertises normal text selection to the browser instead of the old "no selection allowed" style.

3. Alex sweeps a selection across the bubble; the browser reports Alex's own words as the active selection — exactly what copy and paste needs.

4. Alex presses Select All. The selection now includes the words from Alex's own bubble, which the old style silently excluded.
