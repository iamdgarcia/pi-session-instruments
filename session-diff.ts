/**
 * session-diff — compare two pi sessions: what each touched, overlap, conflicts.
 *
 * /session-diff <path-to-session.jsonl> [<path-to-other.jsonl>]
 *   - one path: diffs that session against the CURRENT one.
 *   - two paths: diffs them against each other.
 *
 * Reads only JSONL session files; never writes. For people running several pi
 * sessions in parallel (the new normal): did both touch the same file? Which
 * one explored vs mutated? What would conflict?
 */
import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

type Touched = Map<string, { reads: number; writes: number; lastTool: string }>;

type SessionShape = {
	path: string;
	name: string;
	files: Touched;
	toolCalls: number;
	userTurns: number;
	firstTs: string;
};

function parseSession(path: string): SessionShape {
	const raw = readFileSync(path, "utf-8");
	const files: Touched = new Map();
	let toolCalls = 0;
	let userTurns = 0;
	let firstTs = "";
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		let e: any;
		try {
			e = JSON.parse(line);
		} catch {
			continue;
		}
		if (!firstTs && e.timestamp) firstTs = String(e.timestamp);
		const msg = e.message ?? e;
		const content = msg?.content;
		if (msg?.role === "user") userTurns++;
		if (msg?.role === "assistant" && Array.isArray(content)) {
			for (const b of content) {
				if (b.type === "toolCall" || b.type === "tool_call" || (b.type === "toolUse" && b.name)) {
					toolCalls++;
					const name: string = b.name || b.toolName || "";
					const input = b.arguments ?? b.input ?? {};
					const filePath =
						input.file_path ?? input.path ?? input.filePath ?? input.notebook_path ?? null;
					if (typeof filePath === "string") {
						const cur = files.get(filePath) ?? { reads: 0, writes: 0, lastTool: name };
						if (/^(write|edit|apply_patch|multiedit|notebookedit)/i.test(name)) cur.writes++;
						else cur.reads++;
						cur.lastTool = name;
						files.set(filePath, cur);
					}
				}
			}
		}
	}
	return {
		path,
		name: path.split(/[\\/]/).pop() || path,
		files,
		toolCalls,
		userTurns,
		firstTs,
	};
}

function render(s: SessionShape): string[] {
	const out: string[] = [];
	out.push(`${s.name}: ${s.userTurns} user turns, ${s.toolCalls} tool calls, ${s.files.size} files`);
	const rows = [...s.files.entries()].sort((a, b) => b[1].writes - a[1].writes).slice(0, 12);
	for (const [f, v] of rows) {
		out.push(`   ${v.writes ? "W" : "r"}×${(v.writes || v.reads)} ${f}`);
	}
	return out;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("session-diff", {
		description: "Compare two pi sessions (files touched, overlap, conflicts)",
		handler: async (args, ctx: ExtensionCommandContext) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			if (!parts.length) {
				ctx.ui.notify(
					"usage: /session-diff <session.jsonl> [<other.jsonl>]  (one path = vs current session)",
					"warning",
				);
				return;
			}
			try {
				const a = parseSession(parts[0]);
				let b: SessionShape;
				if (parts[1]) {
					b = parseSession(parts[1]);
				} else {
					// current session: read from its own file via the session manager
					const cur = ctx.sessionManager as any;
					const curPath: string | undefined =
						cur.getSessionPath?.() ?? cur.sessionPath ?? cur.getPath?.();
					if (!curPath) {
						ctx.ui.notify("cannot resolve the current session file path", "error");
						return;
					}
					b = parseSession(curPath);
					b.name = "(current)";
				}
				const lines: string[] = [];
				lines.push(`A: ${render(a)[0]}`);
				lines.push(`B: ${render(b)[0]}`);
				const onlyA = [...a.files.keys()].filter((f) => !b.files.has(f));
				const onlyB = [...b.files.keys()].filter((f) => !a.files.has(f));
				const shared = [...a.files.keys()].filter((f) => b.files.has(f));
				const conflicts = shared.filter((f) => a.files.get(f)!.writes && b.files.get(f)!.writes);
				lines.push("");
				lines.push(`shared files: ${shared.length} · only-A: ${onlyA.length} · only-B: ${onlyB.length}`);
				if (shared.length) {
					lines.push("shared:");
					for (const f of shared.slice(0, 10)) {
						const va = a.files.get(f)!;
						const vb = b.files.get(f)!;
						lines.push(`   A${va.writes ? "W" : "r"}/B${vb.writes ? "W" : "r"} ${f}`);
					}
				}
				if (conflicts.length) {
					lines.push("");
					lines.push(`POSSIBLE CONFLICTS (both wrote): ${conflicts.length}`);
					for (const f of conflicts.slice(0, 10)) lines.push(`   ${f}`);
				}
				ctx.ui.notify(lines.join("\n"), "info");
			} catch (err) {
				ctx.ui.notify(`session-diff failed: ${(err as Error).message}`, "error");
			}
		},
	});
}
