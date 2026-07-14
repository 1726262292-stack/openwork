# Telegram connection refresh-loop fix

1. I open Telegram Connections as an organization admin whose session has been active for more than 15 minutes. The setup screen loads normally without a 403 error or refresh loop.

2. I leave the disconnected Telegram dialog open. The screen remains stable without flickering, repeated failures, or unnecessary status checks.

3. I connect a Telegram bot and complete pairing. The dialog updates to “Connected,” then remains stable once pairing finishes.

4. I try a sensitive action such as disconnecting the bot. OpenWork still requests security confirmation, and after reauthentication the action completes successfully.
