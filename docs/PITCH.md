# ClawBack: pitch kit

## One line

Indian exporters cut prices to absorb US tariffs. The tariffs were struck down and the refunds are going to their US buyers. ClawBack proves the exporter's share and gets it back.

## The problem, in numbers (sources at the end)

- The US collected about **$166 billion** in IEEPA tariffs from more than 330,000 businesses. The Supreme Court held on **20 Feb 2026** that IEEPA does not authorise tariffs.
- CBP refunds the duty **with interest** to the importer of record through **CAPE** (opened 20 Apr 2026). About $81 billion had been refunded by June 2026.
- About **$12 billion** of the refund pool is linked to goods from India: textiles and apparel about $4B, engineering about $4B, chemicals about $2B.
- Most Indian exporters shipped FOB/CIF, so the **buyer** gets the refund, even where the exporter paid for part of the duty through a discount.
- "There is no legal mechanism to compel your US buyer to share the refund." (Skydo's guide.) **This is a negotiation, so it needs evidence, math and a deal structure.**

## What ClawBack does

1. **Reads** invoices, price-revision emails and e-BRC/FIRA bank proofs (Gemma 4, running locally).
2. **Proves** every number: click any figure to see the source line, highlighted, with a confidence badge.
3. **Computes** deterministically: duty paid → absorbed → absorption ratio → fair claim, with CBP interest.
4. **Triages**: DDP shipments go to "claim directly from CBP"; FOB/CIF go to the negotiation pack.
5. **Negotiates**: refund clock, three-option settlement ladder, rebuttals to the four standard objections.
6. **Closes**: claim pack PDF, buyer response link, recovery pipeline.

> AI reads the documents, deterministic code does the math, and a human approves every number.

## 3-minute demo script

| Time | Show | Say |
| --- | --- | --- |
| 0:00 | Portfolio, hero **₹2.85 Cr** | "Kaveri Looms cut prices so its US buyers could survive a 50% tariff. The tariff was struck down. The buyers are getting the refund. ₹2.85 crore of it was paid for by Kaveri." |
| 0:20 | Intake: drop `demo/extra/invoice-139-photo.jpg` | "A phone photo of an invoice. Gemma reads it on this laptop. Nothing goes to the cloud." Point out IOR triage: "Bluestem was DDP, so Kaveri was the importer and claims from CBP directly. We route it out." |
| 0:45 | Buyer: Brightwater, absorption ledger | "Every number is clickable." Click the **baseline price** → the buyer's email opens with the line highlighted: "Baseline price $6.40, from email dated 12 Aug 2025 (Exhibit A-6), line 14." Click the **revised price** → the invoice line. |
| 1:05 | Click **Fair claim** → calculation receipt | "No AI in the math. Formula, real values, result. Same input, same output." |
| 1:20 | Correct a quantity in the proof panel | "A human approves every number. Change it, and the ledger recalculates instantly." |
| 1:40 | Negotiation tab: refund clock | "Brightwater has likely held $125,760 of Kaveri's money since July. That is $1,985 of interest to them so far." |
| 1:55 | Settlement ladder, option C | "Never ask only for cash. Option C settles against the next order: the money stays inside the relationship, so buyers are most likely to accept it." |
| 2:10 | Objection: "the discount was for volume" | "Rules check the evidence: the email names the tariff, the timing matches, and quantities didn't rise. Here's the rebuttal, with exhibits." |
| 2:25 | Claim pack → buyer link → accept C → Pipeline | "A professional claim pack with numbered exhibits. The buyer picks an option on a link, and the pipeline shows the money moving." |
| 2:45 | Close | "Success fee 5–10% of what we recover. Distribution through export promotion councils and CAs. We found no tool for this segment." |

Before the demo: run `npm run doctor`, then **Settings → Run Gemma self-test** so the model is loaded and warm. Use **Load demo workspace** (instant), then upload the photo live.

## Why it is not "an LLM wrapper"

- No chat box. Upload, ledger, proof viewer, claim pack.
- The model's only jobs are reading and citing. A grounding check rejects any value that is not written on the cited line. In the test suite, a model answer with an invented shipment date is caught and flagged.
- The money math is plain TypeScript with 30 automated tests, including the dated rate table with the in-transit exceptions.
- Runs fully offline on an open model (Gemma 4, Apache 2.0). An exporter's pricing data never leaves their laptop.

## Business model

- **Success fee: 5–10%** of amounts recovered (default 7%, shown on the pipeline).
- **Flat fee per claim pack** for small exporters who negotiate themselves (assumption: ₹4,999–9,999 per buyer pack).
- **Channel partners:** export promotion councils (AEPC for apparel, EEPC for engineering, CHEMEXCIL), CAs who keep exporters' books and already hold the e-BRCs, and freight forwarders who hold the shipping documents.
- **Payout partners:** inward-remittance fintechs (e.g. Skydo, whose tariff-refund feature receives refunds but does not negotiate them) can receive settled amounts in INR. This is a partnership, not a conflict.

## Market sizing (illustrative: every input below is an assumption except where cited)

| Step | Value | Basis |
| --- | --- | --- |
| IEEPA refunds linked to Indian goods | ~$12B | BasisPoint Insight, Apr 2026 (cited) |
| Share absorbed by exporters through discounts | 15–25% | **Assumption** |
| Recoverable pool | $1.8–3.0B | 12B × assumption |
| ClawBack-assisted recovery, year 1 | 1% of pool = $18–30M | **Assumption** |
| Revenue at 7% success fee | $1.3–2.1M (₹12–20 Cr) | **Assumption** |

Say "we found no tool for this segment", not "we are the first".

## Competitor check (October 2026)

- **Skydo:** receives refunds for exporters who were the importer of record (DDP) and offers a share calculator. It does not build evidence or negotiate with buyers.
- **US law firms and brokers:** advise importers and file CAPE declarations, and some advise suppliers who *receive* refund demands from customers (the opposite direction).
- **Exporters today:** spreadsheets and phone calls.

## Questions judges will ask

- **"Why would a buyer pay anything?"** The relationship and the next order. Option C costs no cash, and the evidence makes the ask reasonable. We are honest that there is no legal compulsion, which is why the product is built for negotiation.
- **"What if the model hallucinates?"** Values must be grounded on their line, and the rules engine cross-checks them. Disagreements are flagged, and a human approves every value. Show the confidence badges.
- **"Isn't this a one-time event?"** The refund wave runs through 2026–27 (CAPE phases, liquidations, protests). The same engine reconciles any price concession tied to a duty that later changes, e.g. replacement tariffs that are being challenged, and works for exporters in other countries.
- **"Data privacy?"** Everything runs locally on an open model. Nothing is uploaded.
- **"Legal risk?"** Negotiation support, not legal advice. The disclaimer is shown in the app, the claim pack and the buyer portal.

## Sources

- Supreme Court decision and termination of IEEPA duties: White & Case, "United States terminates IEEPA-based tariffs following Supreme Court decision".
- CAPE Phase 1, 60–90 day refunds, ACH to the importer of record: Steptoe, "CBP CAPE mechanism begins processing IEEPA tariff refunds".
- India rates and in-transit exceptions: C.H. Robinson client advisories (Aug 2025, Feb 2026); HTSUS 9903.02.26 text.
- CBP overpayment interest rates: Federal Register notice 2026-13298 (Q3 2026); STR Trade Report quarterly notices.
- $166B total and $81B refunded by June 2026: Wikipedia, "Liberation Day tariffs" (citing government estimates and the Guardian).
- $12B linked to India and the sector split: BasisPoint Insight, 21 Apr 2026.
- "No legal mechanism to compel your US buyer": Skydo, "Trump tariff refund" guide; Skydo tariff-refund feature page.
