# Inkwell

Paste or speak a sample of your writing, give it a prompt, and it drafts the piece in your voice. Free to run on Vercel + Gemini.

## Setup (about 5 minutes, $0)

1. **Get a free Gemini key:** go to https://aistudio.google.com/apikey → *Create API key* → copy it.
2. **Put this folder on GitHub** (new repo → upload these files, keeping the `api` folder).
3. **Import it on Vercel:** vercel.com → *Add New → Project* → pick the repo → *Deploy*.
4. **Add the key:** in the Vercel project → *Settings → Environment Variables* → add
   `GEMINI_API_KEY` = your key → Save → go to *Deployments* → *Redeploy*.

Your site will be at something like `inkwell-yourname.vercel.app`.

## Sources & evidence

Paste up to 5 links. Gemini's URL Context tool reads the pages (Google fetches them, not your site), and the writer quotes them word-for-word with citations. Some sites block it (paywalls, Google Docs, PDFs behind logins) — the site tells you which link failed, and you can paste that text into the "paste the text instead" box.

**Files & photos:** click Upload, paste with Ctrl+V into any box, or drag files onto the page. Works with photos/screenshots (JPG, PNG, WEBP), PDFs, and .txt files. Photos are shrunk automatically; everything together has to stay under about 3.5 MB (Vercel's limit). You can leave the prompt blank and just upload a photo of the assignment. Word files: save as PDF first.

Type any format in the Type box — e.g. "RACES paragraph", "CER", "ACE", "PEEL" — and it follows that structure.

## Limits

- Uses Gemini Flash-Lite first (the biggest free allowance), and falls back to Flash if that's busy.
- Each visitor is capped at 6 requests a minute so one person can't use up your daily quota.
- Free daily limits reset at midnight Pacific time.
- Optional: set `GEMINI_MODEL` in Vercel to force a specific model.

## Files

- `index.html` – the whole site (voice input works in Chrome/Edge)
- `api/write.js` – server function that calls Gemini (keeps your key secret)
