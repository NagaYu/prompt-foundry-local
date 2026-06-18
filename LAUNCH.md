# 🚀 Launch Kit — PromptFoundry Local

Copy-paste–ready go-to-market assets: Product Hunt, X/Twitter, Hacker News, and a
screenshot shot list. Live demo: **https://nagayu.github.io/prompt-foundry-local/**

---

## 🐱 Product Hunt

**Name:** PromptFoundry Local

**Tagline** (≤60 chars):
> Forge perfect AI prompts on-device — $0, no data leaks

*Alternates:*
> - Turn a few words into perfect AI prompts, 100% on-device
> - On-device AI prompt forge — zero servers, zero API cost

**Topics:** Artificial Intelligence · Developer Tools · Productivity · Privacy · Open Source

**Description** (~260 chars):
> PromptFoundry Local turns a few keywords into three production-grade prompts — an image prompt (Midjourney/SD), a structured text prompt (ChatGPT/Claude), and a system prompt. A small LLM runs *in your browser* via WebGPU. No servers, no API cost, nothing leaves your device. 9 languages.

**First comment (maker's comment):**
> Hi Product Hunt 👋
>
> Every "prompt helper" I tried sends your input to a paid cloud API. That means a cost on every prompt and your ideas leaving your device. I wanted the opposite.
>
> **PromptFoundry Local** runs a small open-source LLM *entirely in your browser* (WebGPU, with a WASM fallback). You type a few words; it predicts what you're really trying to make and forges three prompts:
> - 🎨 an image prompt (with camera/lens/lighting + negative prompt),
> - 💬 a structured text prompt for ChatGPT/Claude, in any of 9 languages,
> - ⚙️ a reusable system prompt.
>
> Because there's no inference server, it costs **$0 to run** and **0% of your data leaves the browser** — ever. After the model caches once, it works fully offline, and it installs as a PWA.
>
> It's MIT-licensed and the whole thing is two files. Try it (no signup): https://nagayu.github.io/prompt-foundry-local/
>
> Would love your feedback — especially on the on-device model quality and which languages to improve next. 🙏

**Gallery:** use shots #1–#4 from the shot list below (1270×760 recommended).

---

## 🐦 X / Twitter

**Launch post:**
> I built PromptFoundry Local ⚒️
>
> Type a few words → get a perfect image prompt + ChatGPT/Claude prompt + system prompt.
>
> The twist: the AI runs 100% in your browser (WebGPU). No servers. $0 to run. Nothing leaves your device.
>
> Free + open source 👇
> https://nagayu.github.io/prompt-foundry-local/

**Optional follow-up thread:**
> 1/ Why on-device? Every prompt tool today routes your input through a paid cloud API — a cost on every call and your ideas on someone else's servers. PromptFoundry flips that: the model runs on *your* machine.
>
> 2/ It forges 3 things from a few keywords: a Midjourney/SD image prompt (+ negative), a structured ChatGPT/Claude prompt in 9 languages, and a reusable system prompt.
>
> 3/ No backend = $0 marginal cost, ever. Caches once, then works offline. Installs as a PWA. MIT-licensed. Built with Transformers.js + WebGPU.

---

## 🟧 Hacker News (Show HN)

**Title:**
> Show HN: PromptFoundry Local – on-device AI prompt forge (WebGPU, no data leaves browser)

**Text:**
> I wanted a prompt helper that doesn't send my input to a paid cloud API, so I built one that runs the model entirely in the browser via WebGPU (Transformers.js), with a WASM fallback.
>
> You give it a few keywords; it predicts intent and forges an image prompt (+ negative), a structured text prompt in 9 languages, and a system prompt. There's no backend — $0 to run, nothing leaves the device, works offline after the model caches once, installs as a PWA.
>
> A coherence guard + deterministic localized templates keep output clean even on tiny on-device models. It's MIT and basically two files.
>
> Demo: https://nagayu.github.io/prompt-foundry-local/
> Code: https://github.com/NagaYu/prompt-foundry-local
>
> Feedback welcome — particularly on output quality across the larger model options and on languages to prioritize.

---

## 📸 Screenshot shot list (構図提案)

Capture on a **desktop browser** at ~**1280×800** (full 3-column layout). Forge once first
so the cards are populated. macOS: `⇧⌘5` → record/screenshot; `⇧⌘4` then Space to grab a window.

| # | Shot | How to set it up | Why |
|---|------|------------------|-----|
| **1 — Hero** | Whole app, populated, JA UI | Click **例を入れる** (or paste keywords) → **鋳造** → wait for "鋳造完了 ✓" → scroll to top | The money shot: 3 columns, badges, full result. Use as PH gallery #1 + listing hero. |
| **2 — Output cards** | Right column close-up | Same forged state; scroll so 🎨 image card + 💬 text card are both visible | Proves real, structured output + the "🔒 100% Local / 削減 $0.03" badges. |
| **3 — On-device proof** | Center column | After forge, capture the status panel: "鋳造完了 ✓", the clean live summary, and **累計削減コスト** | Visual proof of the $0 / on-device story. |
| **4 — Multilingual / RTL** | Switch UI to العربية | Top-right 🌐 → **العربية** (layout flips RTL) → screenshot the hero | Shows true global/RTL support — a strong differentiator. |
| **5 — Model picker (optional)** | Left column | Open the **ローカルLLMモデル** dropdown | Shows WebGPU model choices (0.5B/1.5B/Phi-3.5). |

**Tips:** use a clean keyword set (the built-in example works well); make sure the **⚡ WebGPU**
badge is visible (proves GPU acceleration); for the gallery, keep one consistent language per set.

---

## ✅ Launch-day order
1. Take shots #1–#4 (and a 30–60s screen recording of one forge).
2. Post **Show HN** + **X** in the morning (your timezone); reply to every comment.
3. Schedule the **Product Hunt** launch (00:01 PT) with the gallery + maker's comment.
4. Once you have a little traction (visits / upvotes / stars), finalize and post the Acquire.com listing (see `LISTING.md`).
