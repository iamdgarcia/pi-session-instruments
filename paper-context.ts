/**
 * paper-context — pull a SOTA paper into the session as context.
 *
 * /paper <arxiv-id-or-url> [question]  — fetch title+abstract from arXiv and
 * inject them as a context message. The paper lives in the conversation
 * instead of a browser tab.
 *
 * Storage: pi.appendEntry (durable record, not sent to the model) +
 * pi.sendMessage (custom message content the model sees). No processes or
 * timers at load time.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

type PaperData = {
	paperId: string;
	title: string;
	fetchedAt: number;
	chars: number;
};

const ARXIV_ABS = "https://arxiv.org/abs/";

const normalizeId = (raw: string): string =>
	raw
		.trim()
		.replace(/^https?:\/\/(www\.)?(arxiv|alphaxiv)\.org\/(abs|pdf)\//, "")
		.replace(/\.pdf$/, "")
		.replace(/^arXiv:/i, "");

const fetchText = async (url: string, signal: AbortSignal): Promise<string> => {
	const res = await fetch(url, { signal, headers: { "User-Agent": "paper-context-extension" } });
	if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
	return res.text();
};

const fetchPaper = async (
	id: string,
	signal: AbortSignal,
): Promise<{ title: string; abstract: string }> => {
	const abs = await fetchText(ARXIV_ABS + id, signal);
	const titleM = abs.match(/<meta name="citation_title" content="([^"]+)"/);
	const absM = abs.match(/<meta (?:property="og:description"|name="citation_abstract") content="([\s\S]+?)"/);
	if (!titleM || !absM) throw new Error("could not parse the arXiv abstract page");
	return { title: titleM[1].trim(), abstract: absM[1].replace(/\s+/g, " ").trim() };
};

export default function (pi: ExtensionAPI) {
	pi.registerCommand("paper", {
		description: "Fetch a paper (arXiv id/URL) into session context",
		handler: async (args, ctx: ExtensionCommandContext) => {
			const parts = args.trim().split(/\s+/);
			const raw = parts[0] || "";
			const question = parts.slice(1).join(" ");
			if (!raw) {
				ctx.ui.notify("usage: /paper <arxiv-id-or-url> [optional question]", "warning");
				return;
			}
			const id = normalizeId(raw);
			const signal = ctx.signal ?? new AbortController().signal;
			ctx.ui.notify(`Fetching arXiv ${id}…`, "info");
			try {
				const { title, abstract } = await fetchPaper(id, signal);
				const body = question
					? `Paper loaded: "${title}" (arXiv ${id}).\n\nAbstract:\n${abstract}\n\nFocus for this session: ${question}`
					: `Paper loaded: "${title}" (arXiv ${id}).\n\nAbstract:\n${abstract}`;
				pi.appendEntry<PaperData>("paper-context", {
					paperId: id,
					title,
					fetchedAt: Date.now(),
					chars: abstract.length,
				});
				pi.sendMessage({
					customType: "paper-context",
					content: body,
					display: true,
					details: { paperId: id, title },
				});
				ctx.ui.notify(`Paper in context: ${title}`, "info");
			} catch (err) {
				ctx.ui.notify(`paper-context failed: ${(err as Error).message}`, "error");
			}
		},
	});

	pi.registerCommand("papers", {
		description: "List papers loaded this session",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			const branch = ctx.sessionManager.getBranch();
			const papers = branch
				.map((e) => e as { customType?: string; data?: PaperData })
				.filter((e) => e.customType === "paper-context" && e.data)
				.map((e) => e.data as PaperData);
			if (!papers.length) {
				ctx.ui.notify("No papers loaded yet. Try /paper 2307.12307", "info");
				return;
			}
			ctx.ui.notify(
				papers.map((p) => `📄 ${p.title} (${p.paperId}, ${p.chars} chars)`).join("\n"),
				"info",
			);
		},
	});
}
