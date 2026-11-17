// Inkwell — serverless function that talks to Gemini.
// Your API key stays here on the server (set GEMINI_API_KEY in Vercel), never in the browser.

const MODELS = [
  process.env.GEMINI_MODEL,          // optional override
  "gemini-flash-lite-latest",        // highest free-tier limits
  "gemini-2.5-flash-lite",
  "gemini-flash-latest",             // fallback if lite is busy
  "gemini-2.5-flash",
].filter(Boolean);

// Simple per-visitor limit so one person can't burn your whole daily quota.
const hits = new Map();
const LIMIT_PER_MIN = 6;

function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > LIMIT_PER_MIN;
}

const clip = (s, n) => String(s || "").slice(0, n);

const OK_TYPES = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
function cleanFiles(list) {
  return (Array.isArray(list) ? list : [])
    .filter((f) => f && OK_TYPES.test(f.mime) && typeof f.data === "string" && f.data.length > 0)
    .slice(0, 6);
}

function buildPrompt(b) {
  const sample = clip(b.sample, 6000).trim();
  const style = sample
    ? `Here is a sample of the writer's own writing. Study their voice: sentence length, word choice, vocabulary level, punctuation habits, how they start and end paragraphs, and their tone. Write so it sounds like THEM, not like an AI. Do not copy sentences from the sample.\n\n<sample>\n${sample}\n</sample>\n\n`
    : "Write in a natural, clear, human voice. Avoid cliches and filler.\n\n";

  const type = clip(b.type, 120) || "essay";
  const meta = `Type / format: ${type}. Target length: about ${Number(b.length) || 500} words. Tone: ${clip(b.tone, 60) || "match the sample"}.
If the format is a known writing structure (for example RACES = Restate the question, Answer it, Cite evidence, Explain the evidence, Summarize; also CER, ACE, PEEL, TEA, five-paragraph), follow every part of that structure in order, but write it as smooth normal paragraphs without labeling the parts.`;

  const links = (Array.isArray(b.links) ? b.links : []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 5);
  const pasted = clip(b.sourceText, 15000).trim();
  let evidence = "";
  const nFiles = cleanFiles(b.files).length;
  if (links.length || pasted || nFiles) {
    evidence = "SOURCES — use these for evidence:\n";
    if (nFiles) evidence += `${nFiles} attached file(s)/photo(s) are included. Read all text in them carefully (including handwriting and screenshots). If one shows the assignment question or instructions, follow them and answer that question. If one is an article, story or document, treat it as a source and quote it.\n`;
    if (links.length) evidence += `Read these pages: ${links.join(" ")}\n`;
    if (pasted) evidence += `<pasted_source>\n${pasted}\n</pasted_source>\n`;
    evidence += `Evidence rules: Use direct quotes copied EXACTLY word-for-word from the sources, in quotation marks, introduced naturally (e.g. According to [author or site], "..."). Add a short citation after each quote, like (Author or Site Name) or (Title, paragraph 3) when you can tell. Explain how each quote supports the point. NEVER invent a quote, statistic or source. If a source could not be read, rely only on the ones you could read.\n\n`;
  }
  const rules = "Output plain text only: no markdown, no asterisks, no headings symbols. Separate paragraphs with a blank line. Do not add notes or explanations before or after.";
  const ctx = evidence;

  switch (b.action) {
    case "outline":
      return `${style}${ctx}Make an outline for this piece.\n${meta}\nTopic / prompt: ${clip(b.prompt, 3000) || "(see the attached file for the assignment)"}\n\nGive a one-sentence thesis on the first line starting with "Thesis:", then a numbered list of sections, each with a short title and 2-3 bullet points (use "-" for bullets). Plain text only.`;
    case "expand":
      return `${style}${ctx}${meta}\nOverall topic: ${clip(b.prompt, 3000)}\nFull outline for context:\n${clip(b.context, 6000)}\n\nWrite ONLY the section below as finished paragraphs (about ${Math.max(80, Math.round((Number(b.length) || 500) / Math.max(1, Number(b.sections) || 4)))} words). ${rules}\n\nSection to write:\n${clip(b.paragraph, 2000)}`;
    case "rewrite":
      return `${style}${ctx}Here is the surrounding text for context:\n${clip(b.context, 8000)}\n\nRewrite ONLY this paragraph. Instruction: ${clip(b.instruction, 300) || "improve it"}. Keep the writer's voice. Return just the new paragraph. ${rules}\n\nParagraph:\n${clip(b.paragraph, 3000)}`;
    default:
      return `${style}${ctx}Write a complete piece.\n${meta}\nTopic / prompt: ${clip(b.prompt, 3000) || "(see the attached file for the assignment)"}\n\nInclude a title on the first line (plain text), then the body. ${rules}`;
  }
}

// readLinks = true turns on Gemini's URL Context tool: Google fetches the pages, not your Vercel site.
async function callGemini(prompt, key, readLinks, files = []) {
  let lastErr = "No model available";
  for (const model of MODELS) {
    const payload = {
      contents: [{ role: "user", parts: [
        ...files.map((f) => ({ inline_data: { mime_type: f.mime, data: f.data } })),
        { text: prompt },
      ] }],
      generationConfig: { temperature: readLinks ? 0.6 : 0.9, maxOutputTokens: 4096 },
    };
    if (readLinks) payload.tools = [{ url_context: {} }];

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(payload),
      }
    );
    if (r.ok) {
      const data = await r.json();
      const cand = data.candidates?.[0] || {};
      const text = (cand.content?.parts || []).map((p) => p.text || "").join("").trim();
      const failed = (cand.urlContextMetadata?.urlMetadata || [])
        .filter((m) => m.urlRetrievalStatus && m.urlRetrievalStatus !== "URL_RETRIEVAL_STATUS_SUCCESS")
        .map((m) => m.retrievedUrl);
      if (text) return { text, failed };
      lastErr = "Empty response";
      continue;
    }
    lastErr = `${model}: ${r.status}`;
    // 400 with links = this model can't read links -> try next. 404 = model not found, 429/503 = busy.
    if (![400, 404, 429, 503].includes(r.status) || (r.status === 400 && !readLinks)) break;
  }
  throw new Error(lastErr);
}

// Allow bigger request bodies for photos/PDFs (Vercel's hard max is 4.5 MB).
export const config = { api: { bodyParser: { sizeLimit: "4.5mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY. Add it in Vercel → Settings → Environment Variables, then redeploy." });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0] || "unknown";
  if (tooMany(ip)) return res.status(429).json({ error: "Slow down a little — try again in a minute." });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  if (!clip(body.prompt, 10).trim() && body.action !== "rewrite" && !cleanFiles(body.files).length) {
    return res.status(400).json({ error: "Add a prompt or upload your assignment first." });
  }

  try {
    const readLinks = Array.isArray(body.links) && body.links.some((u) => /^https?:\/\//i.test(u));
    const { text, failed } = await callGemini(buildPrompt(body), key, readLinks, cleanFiles(body.files));
    res.status(200).json({ text, failed });
  } catch (e) {
    const busy = /429/.test(e.message);
    res.status(busy ? 429 : 502).json({
      error: busy ? "The free daily limit was reached. It resets at midnight Pacific time." : "The AI didn't respond. Try again.",
      detail: e.message,
    });
  }
}
