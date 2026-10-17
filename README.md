# pi-session-instruments

Session instruments for the [pi coding agent](https://github.com/earendil-works/pi).
Three extensions, zero dependencies, zero API keys:

| Extension | What it does | Command |
|---|---|---|
| **paper-context** | Pull an arXiv paper into the session (title + abstract as context). Research lives in the conversation, not a browser tab. | `/paper 2307.12307 [question]` · list with `/papers` |
| **turn-geometry** | Shape metrics per turn and session: tool calls, read:write ratio, tool time. Everyone measures tokens; this measures shape. | `/tg` · record JSONL with `/tg-jsonl <path>` |
| **session-diff** | Compare two sessions: files each touched, shared files, possible conflicts (both wrote). For parallel pi sessions. | `/session-diff <a.jsonl> [b.jsonl]` (one path = vs current) |

## Install

```bash
pi install npm:pi-session-instruments
```

or try without installing:

```bash
pi -e npm:pi-session-instruments
```

## Why

These came out of running several pi sessions in parallel and reading how agent
quality is actually measured ("show the output, not claims"):

- **paper-context** — the morning arXiv scan kept landing in a different window than the
  work. Now `/paper` puts it where the decisions happen.
- **turn-geometry** — token counters tell you cost; shape tells you behavior. A turn with
  30 reads and 1 write is research; 3 writes with no reads is a code generator with a
  blindfold. Same tokens, different agent.
- **session-diff** — two agents editing one repo is the new normal, and "what did the
  other one touch?" is currently answered by switching windows.

## License

MIT
