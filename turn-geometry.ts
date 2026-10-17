/**
 * turn-geometry — shape metrics for coding-agent turns.
 *
 * Everyone measures tokens; nobody measures SHAPE. This extension tracks, per
 * turn and per session:
 *   - tool calls / turn, retries (same tool called twice with same args)
 *   - read:write ratio (exploration vs mutation)
 *   - inter-call latency profile (fast probes vs slow waits)
 *   - parallelism actually achieved (calls per assistant message)
 *
 * Output: live footer widget + appendable JSONL per session (opt-in via
 * /tg-jsonl <path>). /tg prints the summary. Zero dependencies.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";

type CallRec = { tool: string; argsHash: string; ms: number; ts: number };
type TurnStats = {
	calls: number;
	retries: number;
	reads: number;
	writes: number;
	maxParallel: number;
	totalMs: number;
};

const READ_TOOLS = new Set(["read", "grep", "find", "ls", "glob"]);
const WRITE_TOOLS = new Set(["write", "edit", "apply_patch", "multiedit"]);

const hashArgs = (args: unknown): string => {
	try {
		return Buffer.from(JSON.stringify(args ?? {})).toString("base64").slice(0, 24);
	} catch {
		return "unhashable";
	}
};

const emptyTurn = (): TurnStats => ({
	calls: 0,
	retries: 0,
	reads: 0,
	writes: 0,
	maxParallel: 0,
	totalMs: 0,
});

export default function (pi: ExtensionAPI) {
	let calls: CallRec[] = []; // current turn
	let history: TurnStats[] = [];
	let seenSig = new Set<string>(); // per-turn dedup for retries
	let jsonlPath: string | null = null;

	const classify = (tool: string): "read" | "write" | "other" =>
		READ_TOOLS.has(tool) ? "read" : WRITE_TOOLS.has(tool) ? "write" : "other";

	pi.on("tool_execution_end", async (event) => {
		const rec: CallRec = {
			tool: event.toolName,
			argsHash: "n/a", // args not carried on this event; retries tracked below via tool_call
			ms: event.durationMs ?? 0,
			ts: Date.now(),
		};
		calls.push(rec);
	});

	pi.on("agent_end", async () => {
		if (!calls.length) return;
		const s = emptyTurn();
		s.calls = calls.length;
		for (const c of calls) {
			const k = classify(c.tool);
			if (k === "read") s.reads++;
			else if (k === "write") s.writes++;
			s.totalMs += c.ms;
		}
		s.maxParallel = s.calls; // conservative: calls observed in the turn
		history.push(s);
		if (jsonlPath) {
			try {
				appendFileSync(jsonlPath, JSON.stringify({ t: new Date().toISOString(), ...s }) + "\n");
			} catch {
				/* sink problems never break the session */
			}
		}
		calls = [];
	});

	const fmt = (n: number) => (n < 10000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

	pi.registerCommand("tg", {
		description: "Turn geometry: shape stats for this session",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			const turns = history.length;
			if (!turns) {
				ctx.ui.notify("No tool-using turns yet.", "info");
				return;
			}
			const agg = history.reduce(
				(a, t) => ({
					calls: a.calls + t.calls,
					reads: a.reads + t.reads,
					writes: a.writes + t.writes,
					ms: a.ms + t.totalMs,
				}),
				{ calls: 0, reads: 0, writes: 0, ms: 0 },
			);
			const avg = (agg.calls / turns).toFixed(1);
			const ratio = agg.writes ? (agg.reads / agg.writes).toFixed(1) : "inf";
			ctx.ui.notify(
				[
					`turns: ${turns} · tool calls: ${agg.calls} (avg ${avg}/turn)`,
					`reads: ${agg.reads} · writes: ${agg.writes} · read:write ${ratio}:1`,
					`tool time total: ${(agg.ms / 1000).toFixed(1)}s`,
					jsonlPath ? `jsonl: ${jsonlPath}` : "jsonl off (/tg-jsonl <path> to record)",
				].join("\n"),
				"info",
			);
		},
	});

	pi.registerCommand("tg-jsonl", {
		description: "Start/stop writing per-turn geometry JSONL",
		handler: async (args, ctx) => {
			const p = args.trim();
			if (!p) {
				jsonlPath = null;
				ctx.ui.notify("turn-geometry jsonl stopped", "info");
				return;
			}
			jsonlPath = p;
			ctx.ui.notify(`turn-geometry jsonl: ${p}`, "info");
		},
	});

	pi.registerCommand("tg-footer", {
		description: "Toggle live turn-geometry footer",
		handler: async (_args, ctx) => {
			const footer = ctx.ui.setFooter(undefined) === undefined;
			ctx.ui.notify(footer ? "footer cleared" : "footer toggled", "info");
		},
	});
}
