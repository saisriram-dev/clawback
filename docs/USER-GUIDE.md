# ClawBack

**Your buyers got the tariff refund. Part of it is yours.**

In 2025, Indian exporters cut their prices so that US buyers could absorb the IEEPA tariffs (India's combined rate reached 50%). On 20 February 2026 the US Supreme Court held that IEEPA does not authorise tariffs, and CBP is now refunding those duties, with interest, to the **importer of record**, which is usually the US buyer. There is no legal mechanism that forces the buyer to share that refund with the supplier. What an exporter can do is make a well-documented commercial request.

ClawBack builds that request. It reads your invoices, price-revision emails and bank realisation certificates, proves line by line how much of the buyer's refund your discounts paid for, and produces a claim pack, a settlement menu and rebuttals to the objections buyers raise.

> **Gemma reads the documents. Deterministic code does the math. A human approves every number.**
> Same input, same output, every time. Negotiation support, not legal advice.

---

## Quick start (Windows)

1. Install **Node.js 22 LTS or newer** from <https://nodejs.org> (choose "LTS").
2. Double-click **`start.bat`**.
   The first run installs dependencies and builds the app (about 2–4 minutes, needs internet). After that, it starts in seconds.
3. Your browser opens at <http://localhost:3000>. Click **Load demo workspace** to see a worked example, or go to **Intake** and drop your own documents.

> **OneDrive note:** this folder is on your OneDrive Desktop. Installing creates many files that OneDrive will try to sync. For a faster setup, move the `ClawBack` folder to `C:\ClawBack` first, or pause OneDrive while it installs.

macOS / Linux: run `./start.sh`. Any OS: `npm install`, `npm run build`, `npm start`.

## Turn on Gemma (open model, runs on your computer)

ClawBack works out of the box with its deterministic rules engine. To add Gemma:

1. Install **Ollama** from <https://ollama.com/download>.
2. In a terminal: `ollama pull gemma4:e4b` (about 10 GB download; runs on an 8 GB GPU or a 16 GB RAM laptop).
3. In ClawBack: **Settings → Extraction engine → Test connection**, then **Run Gemma self-test**.

`npm run doctor` checks Node, the data folder, Ollama and the model, and runs a live extraction test.

| Model | When to use it |
| --- | --- |
| `gemma4:e4b` (default) | Best balance for laptops. Reads photos and scans. |
| `gemma4:e2b` | Lighter machines. |
| `gemma4:12b` | More accurate if you have a 12–16 GB GPU. |
| `gemma3:4b` / `gemma3:12b` | If you already have Gemma 3 pulled. |

Gemma 4 is released under the Apache 2.0 licence. ClawBack also works with any **OpenAI-compatible** server hosting Gemma (llama.cpp, LM Studio, vLLM). Choose it under Settings → Server.

### What Gemma does, and what it never does

| Gemma does | Gemma never does |
| --- | --- |
| Classifies a document when the keyword rules are unsure | Any arithmetic |
| Reads each value **and cites the line it is written on** (line number + verbatim quote) | Rate lookups, interest, claim amounts |
| Transcribes photos and scanned PDFs | Decide anything without a human able to check it |

Every value Gemma returns goes through a **grounding check** (`src/lib/extraction/ground.ts`). The quote must be found on the cited line. If the line is wrong, the citation is moved to the right line. If the value is not in the document at all, the field is marked **check** and the rules engine's reading is preferred. Gemma runs at temperature 0 with a fixed seed, and its results are cached by file hash, so re-reading a document gives the same answer.

---

## What's inside

| Feature | Where |
| --- | --- |
| **Absorption ledger**: invoices, price revisions and bank receipts become rows with buyer, invoice, date, HS code, qty, baseline price, revised price, Incoterm and amount realised | Buyer → Absorption ledger |
| **Click-to-proof**: every number opens its source line, highlighted, with a confidence badge; correct any value and the ledger recalculates instantly | Click any number |
| **Calculation receipt**: each formula with the real values plugged in | Click a computed number |
| **IOR triage**: DDP → "You can claim directly from CBP"; FOB/CIF/CFR → negotiation pack | Intake, Portfolio |
| **Refund clock**: "Buyer has likely held your $X since ~July. Interest accruing to them: $Y" | Buyer → Negotiation |
| **Claim pack**: cover letter, summary, ledger with exhibit numbers, method, evidence annex with highlighted lines, settlement menu | Buyer → Claim pack (print or save as PDF) |
| **Settlement ladder**: full credit note / 50-50 split / credit against the next order | Buyer → Negotiation |
| **Portfolio dashboard**: "₹2.85 Cr recoverable across 6 buyers", ranked by recoverable × leverage | Portfolio |
| **Objection handler**: four rules-based rebuttals, each with evidence checks and its strength | Buyer → Negotiation |
| **Recovery pipeline**: Drafted → Sent → Countered → Settled, with INR recovered | Recovery pipeline |
| **Buyer response portal**: a shareable link where the buyer picks an option | Buyer → Negotiation → Buyer response link |
| **e-BRC / FIRA awareness**: "amount realised" comes from bank proof; short payments and credit notes are detected | Ledger "Bank" column |

Supported files: PDF (digital or scanned), `.eml`, `.docx`, `.xlsx`, `.csv`, `.txt`, `.html`, and photos (`.jpg`, `.png`, `.webp`). You can also paste an email or WhatsApp message on the Intake page. Outlook `.msg` and legacy `.doc` / `.xls` files are rejected with instructions to convert them.

## The math (all in `src/lib/engine/` and `src/lib/ledger.ts`)

```
tariff_paid      = customs_value × IEEPA_rate(entry_date, loading_date)
absorbed         = min((baseline_price − revised_price) × qty, tariff_paid)
absorption_ratio = absorbed ÷ tariff_paid
fair_claim       = absorption_ratio × (refund + CBP interest)
```

- **India IEEPA rate table** (`rates.ts`): 10% baseline from 5 Apr 2025; 25% from 7 Aug 2025; an additional 25% from 27 Aug 2025 (50% combined); the additional duty is removed for entries from 7 Feb 2026; no IEEPA duty on entries from 24 Feb 2026. The in-transit exceptions use the loading date. The 18% rate announced on 2 Feb 2026 was to apply only once the interim agreement entered into force, so ClawBack keeps 25%. HS chapters that were exempt or covered by Section 232 are flagged for you to check, never silently zeroed.
- **Customs value** excludes international freight and insurance (C-terms), whether they are inside the unit price or added below the line.
- **Discount on the invoice vs. credit note after shipment**: both are handled. With a credit note, the customs value used the original price.
- **CBP interest** (`interest.ts`): the IRS overpayment rate by quarter (corporate 6%, 5% in Q2 2026), compounded daily from the deposit date to the refund date.
- **Refund clock** (`refundClock.ts`): CAPE Phase 1 opened 20 Apr 2026, and CBP expects refunds 60–90 days after a declaration is accepted. If the buyer confirms a date, ClawBack uses it.
- **Leverage** (`leverage.ts`): 100 × (0.40 × years/10 + 0.35 × open orders + 0.25 × (1 − revenue share ÷ 50%)).

Sources are listed in the app under **Method & sources**. Tariff rules change; confirm the treatment of your entries with your customs broker.

## Your data

Everything stays on your computer. The workspace is `data/workspace.json`, with uploads in `data/uploads/`. Set `CLAWBACK_DATA_DIR` to keep it elsewhere (see `.env.example`). Writes are atomic and keep a backup, and they retry when Windows or OneDrive briefly locks a file. Settings → Data downloads a JSON backup and a CSV of the ledger.

By default the app listens only on this computer (`127.0.0.1`). To let a buyer open the response link, run `start-lan.bat` (same network), or deploy ClawBack or use a tunnel such as Cloudflare Tunnel.

## Demo files

`demo/` holds a fictional exporter (Kaveri Looms Pvt Ltd, Karur) and seven fictional US buyers: 30 documents with invoices, price-revision emails, an e-BRC CSV export, FIRA and e-BRC PDFs, a CAPE refund confirmation from a broker, and one DDP buyer. All names, addresses, banks and vessels are invented.

`demo/extra/` holds files for a live demo: a new invoice (`invoice-139-kestrel-bay.pdf`), a phone photo of it (`invoice-139-photo.jpg`) and a scanned PDF (`invoice-139-scanned.pdf`). The photo and the scan show Gemma reading images. `demo/try-pasting-this-email.txt` is for the paste box.

## Development

```
npm run dev          # dev server on http://127.0.0.1:3000
npm test             # 30 tests: rate table, interest, extraction, grounding, Gemma client (mock Ollama), store, pipeline
npm run typecheck
npm run doctor
npm run demo:generate
```

Stack: Next.js 15 (App Router) + TypeScript, plain CSS, pure-JS parsers (unpdf/pdf.js, postal-mime, mammoth, read-excel-file) with no native modules, and Ollama for Gemma.

```
src/lib/engine/       deterministic engine: rates, interest, refund clock, IOR triage, leverage, settlement, objections, normalisation
src/lib/extraction/   ingest (files → numbered lines), rules extractor, Gemma client, grounding + merge
src/lib/ledger.ts     absorption ledger, per-buyer and portfolio
src/lib/server/       JSON store, buyer matching, processing queue
src/app/              UI pages, API routes, claim pack (/claim/[id]), buyer portal (/r/[token])
```

---

*ClawBack is negotiation support, not legal advice.*
