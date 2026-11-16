# Self-host: History, Schedule, Mashup

These tabs appear when `BILLING_ENABLED` is off (local Docker).

## 1. History

- Each finished clip is one row in `data/local_history.json`.
- Past jobs under `output/` with metadata are indexed on load.
- **History** tab lists clips and lets you reopen a job like cloud mode.

## 2. Schedule (YouTube + Instagram, New York time)

OpenShorts does **not** ship first-party YouTube or Instagram OAuth upload in self-host mode. You have two choices:

### A. Manual (default — no API key)

**You provide:** nothing secret. Use your normal Google / Meta logins in the browser when you upload.

1. **Schedule** tab → backend **Manual** → enable queue, set interval (e.g. 2 hours), pick platforms (labels only).
2. When a slot is due, the app copies the clip to `data/ready_to_post/<queue-id>/clip.mp4` and writes `manifest.json` (title, description hint, platforms, planned time).
3. Upload yourself:
   - **YouTube:** [YouTube Studio](https://studio.youtube.com) → Create → **Short** → pick `clip.mp4`, paste title from manifest.
   - **Instagram:** professional/creator account → **Reel** → upload same file, caption from manifest.

Optional env: `SELF_HOST_POSTING_BACKEND=manual` (default when `UPLOAD_POST_API_KEY` is unset).

### B. Upload-Post (automated)

**You provide (`.env`):**

| Variable | What |
|----------|------|
| `UPLOAD_POST_API_KEY` | API key from [upload-post.com](https://upload-post.com) |
| `UPLOAD_POST_PROFILE` | Your Upload-Post profile id (often `os_…`) |

**You provide (Upload-Post website):**

- Connect **YouTube** and **Instagram** to that profile (OAuth once).

**In the app:** Schedule tab → backend **Upload-Post** → same queue/enqueue API as before.

### Direct YouTube / Instagram APIs (not built-in)

If you want automation **without** Upload-Post, you would need to run your own small uploader (or ask us to add a future backend). Typical credentials (keep these in `.env` on your machine — **never paste into chat**):

| Platform | What you'd register | What you'd store locally |
|----------|---------------------|---------------------------|
| **YouTube** | Google Cloud project + YouTube Data API v3; OAuth desktop or web client | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, long-lived **refresh token** for the channel |
| **Instagram** | Meta developer app; Instagram Graph API; **Business/Creator** account linked to a Facebook Page | Page id, Instagram business account id, **long-lived user/page access token** with `instagram_content_publish` |

That path is more setup than manual export or Upload-Post; self-host today supports **manual** and **Upload-Post** only.

**API:** `POST /api/self-host/schedule/enqueue` with `{"job_id","clip_index"}`. Times use **`America/New_York`** by default (changeable via PUT `timezone`).

## Music videos / little speech (no Gemini)

OpenShorts normally uses **transcript + Ollama** when people talk. Music videos,
instrumentals, and sparse lyrics switch to a **beat + scene** picker: audio energy
peaks (drops, chorus hits) and shot cuts, without sending video to Gemini. If
`GEMINI_API_KEY` is set, Gemini vision still runs first for silent footage; without
it, the heuristic picker is used automatically (works in regions where Gemini is
unavailable).

Titles/hooks use Ollama when `LLM_BASE_URL` is set; otherwise simple defaults.

## 3. Mashup

- **Mashup** tab: 2–3 job ids + clip indices from History.
- Optional **music URL**; Ollama orders segments.
- **You control effects:** each row is `type` + `start`/`end` seconds + optional `strength`.
- Types match the main editor: `zoom_in`, `punch_in`, `zoom_pulse`, `color_pop`, `bw_moment`, `flash`, `vignette`.
- **Suggest beats** calls `POST /api/self-host/mashup/suggest-beats` on the music URL (editable before render).
- **Auto beats** merges suggestions with your timeline (music bed or mixed dialogue).
- **Effect at joins** places an effect at each stitch point.

`GET /api/self-host/mashup/effects` lists allowed types and strength caps.

## Git commit author

Git author is **your machine’s** config, not OpenShorts. In this repo only:

```bash
git config user.name "kcleung283"
git config user.email "you@example.com"
```

Future commits use that identity locally; past commits stay as they were.