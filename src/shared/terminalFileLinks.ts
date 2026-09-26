/** A Markdown location and its clickable span in the original terminal text. */
export interface MarkdownTerminalLocation {
	startIndex: number;
	length: number;
	path: string;
	line: number;
	column: number;
}

/**
 * Find Markdown file:line[:column] locations in unwrapped terminal text.
 *
 * @param text Plain terminal text, without ANSI escape sequences.
 * @returns Locations in source order, with UTF-16 spans including source quotes.
 * Paths are preserved verbatim (apart from quotes); the host resolves them.
 * Spaces and wrapper punctuation in paths require single or double quotes.
 * Quotes may surround the path alone or the entire location; escapes within
 * quoted paths are not interpreted.
 */
export function findMarkdownTerminalLinks(text: string): MarkdownTerminalLocation[] {
	// Validate whole tokens so an invalid column cannot become a line-only link.
	// Colons remain part of tokens to support drives, filenames and file URIs.
	const tokens = /"[^"\r\n]*"[^\s"'`()\[\]{}<>,;]*|'[^'\r\n]*'[^\s"'`()\[\]{}<>,;]*|[^\s"'`()\[\]{}<>,;]+/g;
	const locations: MarkdownTerminalLocation[] = [];

	for (const match of text.matchAll(tokens)) {
		// Sentence punctuation is outside the clickable span; source quotes stay.
		const source = match[0].replace(/[.!?]+$/, '');
		let location = source;
		const quote = source[0];
		if (quote === '"' || quote === "'") {
			const closingQuote = source.indexOf(quote, 1);
			const quoted = source.slice(1, closingQuote);
			const suffix = source.slice(closingQuote + 1);
			// Quotes around only the path must be followed by a complete suffix.
			if (suffix && !/^:\d+(?::\d+)?$/.test(suffix)) continue;
			location = quoted + suffix;
		}

		const parsed = /^(.+\.(?:md|markdown)):(\d+)(?::(\d+))?$/i.exec(location);
		if (!parsed) continue;
		const [, path, lineText, columnText] = parsed;
		if (/^https?:\/\//i.test(path)) continue;

		const line = Number(lineText);
		const column = columnText === undefined ? 1 : Number(columnText);
		if (!Number.isSafeInteger(line) || line < 1
			|| !Number.isSafeInteger(column) || column < 1) continue;

		locations.push({ startIndex: match.index!, length: source.length, path, line, column });
	}

	return locations;
}
