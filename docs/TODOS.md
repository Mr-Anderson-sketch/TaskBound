# TODOS (deferred scope)

Items reviewed and consciously deferred. Each has a reason and a trigger for revisiting.

- **Folder sync** (user-chosen OneDrive/Dropbox/Syncthing folder, last-writer-wins + conflict copy). Reason: v1 is local-first; needs conflict UX. Trigger: first paying users ask for a second machine.
- **Focus stats week view** (focus minutes per day, completions). Reason: nice, not core to the strip. Trigger: after `days` records accumulate for real users.
- **Hide strip when a fullscreen app is active** (poll foreground window via `powershell`-free native call). Reason: needs a native module or `win32` probing; auto-hide covers most cases. Trigger: complaints from gamers/presenters.
- **Calendar overlay** (read-only ICS). Reason: scope. Trigger: post-v1.
- **Markdown vault import** (Obsidian-style `- [ ]` lines from a folder). Reason: Markdown export/import of TimeBound's own format ships; vault import is a different parser. Trigger: user demand.
- **Per-list strips**. Rejected for now: dilutes the one-strip idea.
- **Code signing**. Needs a paid certificate; question for the founder.
- **macOS polish** (menu bar item instead of tray, `panel` window level). Reason: Windows first. Trigger: macOS testers.
- **Markdown-file source mode** (watch a `.md`, first unchecked `- [ ]` line is the current task; complete = tick it). Reason: v1 owns its data; this is a second source behind the same selector. Trigger: Obsidian/Logseq users ask.
- **Offline licence keys** (Ed25519-signed key, trial clock). Reason: brief forbids licence integration without asking. Trigger: founder approval.
