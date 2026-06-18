# Acquire.com Listing — PromptFoundry Local

Copy-paste–ready fields for an Acquire.com (or Flippa / MicroAcquire) listing, plus an
honest, comps-based pricing recommendation. Replace the **[bracketed]** placeholders.

---

## 📋 Listing fields

**Business / asset name:** PromptFoundry Local

**Tagline (1 line):**
> A 100%-on-device AI prompt forge — turn a few words into perfect image, text & system prompts. $0 to run, 0% data leakage, with margins that *improve* as it scales.

**Category:** AI / Developer Tools / Productivity (Web app — code & IP asset)

**Asking price:** **$9,000 USD (negotiable)** — *see rationale below*

**Business model:** Currently pre-revenue (open monetization — see Growth). Zero hosting/COGS by design.

**Tech stack:** Vanilla JS SPA · Transformers.js · WebGPU (WASM fallback) · Web Worker · Tailwind (CDN) · PWA (service worker + manifest). No backend, no database, no dependencies to maintain.

**TTM revenue / profit:** $0 / $0 (pre-revenue). **Operating cost: $0** (fully static; no inference servers).

---

## 📝 Description (paste into the listing body)

**The problem — the 2026 "Prompt Divide."**
Generative AI capability is now gated less by model access than by *prompting skill*. Most people can't turn a vague idea into a high-yield prompt — and every "prompt helper" tool on the market today routes user input through **paid, server-side LLM APIs**. That saddles incumbents with three structural liabilities: a marginal cost on every prompt, user data leaving the device (a compliance landmine), and dependence on a third party's uptime and rate limits.

**The product.**
PromptFoundry Local closes that divide by running the intelligence **on the user's own device.** Type a few keywords; a small open-source LLM runs *inside the browser* via WebGPU and forges three production-grade prompts:
- 🎨 an **image-generation prompt** (Midjourney/Stable Diffusion-style, with camera/lens/lighting + a negative prompt),
- 💬 a **structured text prompt** for ChatGPT/Claude in any of 9 languages,
- ⚙️ a reusable **system prompt**.

A robustness layer (coherence guard + deterministic, localized templates) guarantees professional output even on tiny models. The whole thing is an installable, offline-capable PWA.

**Why it's special — inverted unit economics.**
There is **no inference server**, so there is **no marginal cost per prompt — ever.** Where every competitor's serving bill grows with usage, here it stays flat at zero and gross margin approaches 100% as you scale. User input **never leaves the browser**, so the compliance story (GDPR/HIPAA-adjacent) is trivial by construction. A full 9-language UI (incl. RTL Arabic) makes it globally distributable on day one.

**What you're buying.**
A complete, polished, *working* codebase with a genuinely novel architecture and a clean acquisition narrative — ready to embed, white-label, or monetize.

---

## 📦 What's included
- Full source code (MIT) — `index.html`, `app.js`, README, PWA assets, model-bundling script.
- 9-language localized UI (ja/en/zh/ko/es/fr/de/ar/hi) with RTL support.
- Production hardening: WebGPU→WASM fallback, off-main-thread loading, quality guard, offline PWA.
- Documentation: end-user quick start + buyer/strategic rationale (README) + this listing kit.
- Clean, dependency-free architecture — trivially embeddable (iframe / web component / WebView / Electron).

## 🚀 Growth opportunities (for the buyer)
1. **Monetize with a Pro tier** — bigger on-device models, prompt history/library, team presets, export. Pure client-side, so still ~0 COGS.
2. **White-label / embed** into existing creative or productivity suites — adds AI prompting with *zero added cloud cost*.
3. **Browser/OS/hardware showcase** — a flagship on-device-AI demo for NPU/GPU vendors.
4. **Distribution** — Chrome Web Store / Edge add-on / desktop (Electron/Tauri) wrappers from the same code.
5. **Regulated verticals** — finance/health/gov, where "no data leaves the device" is the entire sales pitch.

## 🧭 Reason for selling
[e.g. "Solo builder focusing on a different project; want it in the hands of a team that can scale distribution." — keep it short and honest.]

## 📊 Traction / metrics
[Pre-revenue. Add anything real: GitHub stars, demo visits, Product Hunt rank, waitlist signups, social reach. Even modest numbers materially raise the price — see below.]

---

## 💰 Pricing rationale (honest, comps-based)

**Reality check on Acquire.com:** buyers there anchor heavily on **MRR/profit** (typical profitable micro-SaaS clears ~**3–5× annual profit**). A **pre-revenue, no-traction** asset is valued as *code + IP + story*, which clears far lower regardless of code quality.

**Comparable pre-revenue / code-asset listings** generally transact in the **$1k–$15k** band:
- Bare pre-revenue side projects / starters: ~**$500–$5,000**.
- Polished, novel, genuinely-working pre-revenue apps with a clear niche (this asset): **$3,000–$12,000** asking, often clearing **$2k–$8k**.

**Recommendation:**
- **List at $9,000 (negotiable)** to anchor as a *technology/IP asset*, not a "template."
- Expect realistic offers in the **$2,000–$8,000** range while pre-traction.
- Set a **floor you'll accept** privately (e.g. ~$2,500) before negotiating.

**The single biggest lever is traction.** Adding any of the following before/after listing can re-rate it to **$20k–$60k+**:
- Even **$200–$1,000 MRR** from a Pro tier → flips it to a revenue-multiple valuation.
- A viral demo (Product Hunt / Hacker News / X) with real visit numbers.
- A signed white-label/embed pilot with one company.

> TL;DR — list at **$9k**, hold a **~$2.5k** floor, and chase a little traction or MRR, which is worth far more than any wording in the listing.

---

## ✅ Pre-listing checklist
- [ ] Deploy the live demo (GitHub Pages) and put the URL at the top of the listing.
- [ ] Record a 30–60s screen capture of a real forge (input → 3 prompts) for the listing media.
- [ ] Take 3–4 clean screenshots (hero, output cards, an RTL/other-language view) → use as `og:image`.
- [ ] Fill the **[bracketed]** fields above (asking price, reason for selling, metrics).
- [ ] Confirm the MIT `LICENSE` copyright name is yours.
- [ ] (Optional) Post the demo somewhere public first to gather a few traction numbers.
