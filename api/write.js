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
const LIMIT_PER_MIN = 14;

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

const gradeLabel = (v) => !v ? "grade 7-8" : Number(v) >= 13 ? "college" : `grade ${Number(v)}-${Number(v) + 1}`;

function buildPrompt(b) {
  const sample = clip(b.sample, 6000).trim();
  const natural = b.voice === "natural";
  const voiceRules = natural
    ? `VOICE MODE: "Like me". Copy the writer's habits too, not just their words: slang, casual phrasing, sentence patterns (run-ons, short fragments, starting sentences with "And" or "So"), and any mistakes they make CONSISTENTLY, meaning the same misspelling, word mix-up or grammar slip showing up more than once (for example "alot", there/their, "could of", missing commas before "but"). Repeat those habits at about the same rate they appear in the sample. Do NOT invent new random mistakes they never made. If the sample has no punctuation at all, it is probably a voice transcript, so still end sentences with normal punctuation and capitals.`
    : `VOICE MODE: "Polished". Sound like the writer, but with 100% correct spelling, grammar, punctuation and capitalization. Fix any mistakes or habits from the sample instead of copying them.`;
  const style = sample
    ? `Here is a sample of the writer's own writing. Study their voice: sentence length, word choice, vocabulary level, how they start and end paragraphs, and their tone. Write so it sounds like THEM, not like an AI. Do not copy sentences from the sample.
STRICT RULE: the sample is ONLY for HOW they write, never for WHAT to write. It may be random rambling or a voice recording about unrelated stuff. NEVER bring any facts, opinions, stories, people, foods, hobbies, details or topics from the sample into the writing (for example if they mentioned they don't eat dairy, that must not appear). The content must come only from the prompt and the sources.\n${voiceRules}\n\n<sample>\n${sample}\n</sample>\n\n`
    : "Write in a natural, clear, human voice with correct punctuation and grammar. Avoid cliches and filler.\n\n";

  const type = clip(b.type, 120) || "essay";
  const meta = `Type / format: ${type}. Target length: about ${Number(b.length) || 500} words. Tone: ${clip(b.tone, 60) || "match the sample"}. Reading level: ${b.level ? (Number(b.level) >= 13 ? "college" : "about grade " + Number(b.level) + " (use vocabulary and sentence length a student in that grade would)") : "match the writer's sample"}.
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
  const grammar = natural && sample
    ? "Punctuate sentences normally, but keep the writer's habits from the VOICE MODE rules."
    : "Always use correct punctuation, capitalization and grammar: periods, commas, apostrophes, quotation marks and capital letters at the start of sentences.";
  const rules = grammar + " Output plain text only: no markdown, no asterisks, no headings symbols. Separate paragraphs with a blank line. Do not add notes or explanations before or after.";
  const ctx = evidence;

  switch (b.action) {
    case "outline":
      return `${style}${ctx}Make an outline for this piece.\n${meta}\nTopic / prompt: ${clip(b.prompt, 3000) || "(see the attached file for the assignment)"}\n\nGive a one-sentence thesis on the first line starting with "Thesis:", then a numbered list of sections, each with a short title and 2-3 bullet points (use "-" for bullets). Plain text only.`;
    case "expand":
      return `${style}${ctx}${meta}\nOverall topic: ${clip(b.prompt, 3000)}\nFull outline for context:\n${clip(b.context, 6000)}\n\nWrite ONLY the section below as finished paragraphs (about ${Math.max(80, Math.round((Number(b.length) || 500) / Math.max(1, Number(b.sections) || 4)))} words). ${rules}\n\nSection to write:\n${clip(b.paragraph, 2000)}`;
    case "grade":
      return `You are a fair but honest teacher grading a student's writing.\nGrade it as a ${gradeLabel(b.gradeAs)} assignment: judge it against what a strong ${gradeLabel(b.gradeAs)} student can do, not against adult or professional writing. Be consistent: if the writing does everything the assignment asks with only minor slips, it deserves an A range score.\n${meta.replace(/Target length[^.]*\.\s*/, "")}\n${clip(b.rubric, 3000) ? "Assignment / rubric to grade against:\n" + clip(b.rubric, 3000) + "\n" : ""}${nFiles ? "Attached files may show the assignment, rubric or source text — use them.\n" : ""}${pasted ? "Source text the student was supposed to use:\n" + pasted + "\n" : ""}
Grade the writing below. If a structure like RACES/CER/ACE was asked for, check every part is there. Check that quotes are real and explained.
Reply with ONLY JSON in exactly this shape:
{"score": 0-100, "letter": "A+ to F", "summary": "2 sentences, talk to the student directly",
 "categories": [{"name": "Claim / thesis", "score": 0-10, "comment": "..."}, {"name": "Evidence", ...}, {"name": "Explanation", ...}, {"name": "Organization", ...}, {"name": "Grammar & spelling", ...}, {"name": "Voice & word choice", ...}],
 "strengths": ["...", "..."],
 "fixes": [{"quote": "exact short piece of their text", "problem": "...", "fix": "..."}]}
Give 3-6 fixes, most important first.

<writing>
${clip(b.essay, 15000)}
</writing>`;
    case "level":
      return `${style}${ctx}Rewrite the WHOLE piece below so it reads at about a ${clip(b.target, 30)} reading level (${b.direction === "simpler" ? "simpler: shorter sentences, more common words, explain ideas plainly" : "more advanced: richer vocabulary, more varied and complex sentences, deeper analysis"}).
Keep the same ideas, structure, format and paragraph count. Keep every direct quote and citation exactly as it is. Keep the writer's voice. Include the title on the first line. ${rules}

<writing>
${clip(b.essay, 15000)}
</writing>`;
    case "revise": {
      const lenRule = b.lengthMode === "shorter" ? "Make it about 25% shorter." : b.lengthMode === "longer" ? "Make it about 40% longer with more detail, evidence and explanation." : "Keep about the same length.";
      return `${style}${ctx}${meta.replace(/Target length[^.]*\./, lenRule).replace(/Reading level:[^.]*(\([^)]*\))?\./, "")}
Reading level: write at a ${gradeLabel(b.level)} level (vocabulary and sentence complexity a strong student in that grade would use).
GOAL: this rewrite must score at least ${Number(b.goal) || 93}/100 when graded as a ${gradeLabel(b.gradeAs || b.level)} assignment.
Here is the writing and a teacher's grading feedback (JSON). Rewrite the WHOLE piece.
What to do: ${clip(b.instruction, 500) || "fix everything in the feedback"}.
Be thorough: fix EVERY item in "fixes", and improve EVERY category scored below 9. Make the claim clear and specific, use strong evidence (quoted exactly from the sources if there are any; never invent quotes), explain how each piece of evidence proves the point, organize with clear topic sentences and transitions, and end with a strong conclusion. If a structure like RACES/CER is required, make every part obvious.
Keep the writer's main ideas and voice. Include the title on the first line. ${rules}

<feedback>
${clip(b.feedback, 6000)}
</feedback>

<writing>
${clip(b.essay, 15000)}
</writing>`;
    }
    case "rewrite":
      return `${style}${ctx}Here is the surrounding text for context:\n${clip(b.context, 8000)}\n\nRewrite ONLY this paragraph. Instruction: ${clip(b.instruction, 300) || "improve it"}. Keep the writer's voice. Return just the new paragraph. ${rules}\n\nParagraph:\n${clip(b.paragraph, 3000)}`;
    default:
      return `${style}${ctx}Write a complete piece.\n${meta}\nTopic / prompt: ${clip(b.prompt, 3000) || "(see the attached file for the assignment)"}\n\nInclude a title on the first line (plain text), then the body. ${rules}`;
  }
}

// readLinks = true turns on Gemini's URL Context tool: Google fetches the pages, not your Vercel site.
async function callGemini(prompt, key, readLinks, files = [], json = false) {
  let lastErr = "No model available";
  for (const model of MODELS) {
    const payload = {
      contents: [{ role: "user", parts: [
        ...files.map((f) => ({ inline_data: { mime_type: f.mime, data: f.data } })),
        { text: prompt },
      ] }],
      generationConfig: { temperature: json ? 0.3 : readLinks ? 0.6 : 0.9, maxOutputTokens: 4096, ...(json ? { responseMimeType: "application/json" } : {}) },
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
  if (!clip(body.prompt, 10).trim() && body.action !== "rewrite" && !cleanFiles(body.files).length && !["grade", "revise", "level"].includes(body.action)) {
    return res.status(400).json({ error: "Add a prompt or upload your assignment first." });
  }

  try {
    const isGrade = body.action === "grade";
    const readLinks = !isGrade && Array.isArray(body.links) && body.links.some((u) => /^https?:\/\//i.test(u));
    const { text, failed } = await callGemini(buildPrompt(body), key, readLinks, cleanFiles(body.files), isGrade);
    res.status(200).json({ text, failed });
  } catch (e) {
    const busy = /429/.test(e.message);
    res.status(busy ? 429 : 502).json({
      error: busy ? "The free daily limit was reached. It resets at midnight Pacific time." : "The AI didn't respond. Try again.",
      detail: e.message,
    });
  }
}
