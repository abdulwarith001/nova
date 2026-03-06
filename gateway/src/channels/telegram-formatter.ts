/**
 * telegram-formatter.ts — Converts standard Markdown to Telegram HTML.
 *
 * The LLM outputs standard Markdown but Telegram expects its own format.
 * We use HTML parse_mode because it's more forgiving with escaping than MarkdownV2.
 */

/**
 * Convert standard Markdown text to Telegram-compatible HTML.
 */
export function markdownToTelegramHtml(text: string): string {
  // First, escape HTML entities in the raw text
  let html = escapeHtml(text);

  // Code blocks (``` ... ```) — must be done BEFORE inline code
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const langAttr = lang ? ` class="language-${lang}"` : "";
    // Un-escape HTML entities inside code blocks (code should be literal)
    return `<pre><code${langAttr}>${code.trimEnd()}</code></pre>`;
  });

  // Inline code (`...`)
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold (**...**)
  html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // Italic (*...*) — but not inside bold tags
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<i>$1</i>");

  // Strikethrough (~~...~~)
  html = html.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Blockquotes (> ...) — group consecutive lines
  html = html.replace(
    /(?:^|\n)&gt; (.+?)(?=\n(?!&gt;)|$)/gs,
    (_match, content) => `\n<blockquote>${content.trim()}</blockquote>`,
  );

  // Headings — convert to bold (Telegram has no heading support)
  html = html.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // Clean up double newlines around block elements
  html = html.replace(/\n{3,}/g, "\n\n");

  return html.trim();
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Format text for streaming — handles incomplete Markdown gracefully.
 * Only converts complete tokens; leaves unclosed ones as-is.
 */
export function formatStreamingChunk(accumulated: string): string {
  // For streaming, skip code block conversion if blocks are unclosed
  const codeBlockCount = (accumulated.match(/```/g) || []).length;
  if (codeBlockCount % 2 !== 0) {
    // Unclosed code block — just escape HTML and format what we can
    let html = escapeHtml(accumulated);
    // Still format inline elements that are safe
    html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<i>$1</i>");
    return html.trim();
  }

  return markdownToTelegramHtml(accumulated);
}

/**
 * Format sources list for Telegram HTML.
 */
export function formatSourcesHtml(
  sources: Array<{ title?: string; url?: string }>,
): string {
  return "";

}
