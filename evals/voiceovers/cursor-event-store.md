# cursor-event-store — One reliable cursor primitive for workspace events

1. A fresh event store starts at a known cursor and assigns strictly increasing sequence numbers as workspace events arrive.

2. Consumers can read one workspace after a cursor and receive only newer events in their original order.

3. Reload, session-group, and file-session events keep their domain-specific payloads while sharing the same bounded cursor behavior.

4. When the buffer reaches its limit, old events are evicted without resetting the cursor or leaking events across workspaces.
