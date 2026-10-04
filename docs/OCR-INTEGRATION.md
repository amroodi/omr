# OCR integration & measurement guide

How to plug a self-hostable vision model into the platform and measure its accuracy on your own
documents before trusting it. The architecture is already in place — OCR assists, a human
confirms, and deterministic validators catch errors (see the claim-fields module and
`common/validation`).

## 1. Where it plugs in

Everything routes through one interface, `OcrService.extract` in
`apps/api/src/integrations/ocr/ocr.service.ts`:

```ts
extract(buffer: Buffer, mimeType: string, kind: DocumentKind): Promise<{
  text: string;
  fields: Record<string, { value: string; confidence: number }>; // keyed by ClaimFieldDef.key
  engine: string;
}>
```

- On claim document upload, the platform calls this and feeds the returned `fields` into
  `ClaimFieldsService.ingestOcrDraft`, which writes them as **unconfirmed drafts** (source `OCR`,
  with confidence and the source document id). It never overwrites a human-confirmed value.
- You implement a new driver branch in `extract()` keyed on `OCR_DRIVER` (env). Call sites do not
  change. Set `OCR_DRIVER=vision` (or your name) and point it at your inference server.

The `fields` keys must match the `ClaimFieldDef.key` values (e.g. `national_code`, `death_date`,
`payable_amount`, `beneficiary_iban`, …). `GET /api/v1/claim-fields` lists them.

## 2. Model choice (self-hostable, Persian)

Run everything **on-prem**. These are sensitive identity documents, and sending them to a foreign
cloud OCR raises data-residency and sanctions problems. Keep the model and inference server inside
your own infrastructure.

Two workable approaches:

- **Vision LLM, end-to-end (recommended).** A multilingual vision model reads the image and returns
  the fields as JSON. Best for varied layouts, stamps, and mixed print/handwriting.
  - **Qwen2.5-VL** (7B for a pilot, 32B/72B for production) — strong Persian, good document
    understanding. Serve with **vLLM** (OpenAI-compatible HTTP API).
  - Alternatives: **InternVL 2.5**, **Llama 3.2 Vision**.
- **OCR engine + LLM extraction.** A dedicated OCR produces text + layout, then an LLM maps it to
  fields. Good when you also want raw searchable text.
  - OCR: **Surya** or **PaddleOCR** (both handle Persian/Arabic script and layout) — avoid plain
    Tesseract for handwriting.

Pilot hardware: a 7B vision model fits on one 24 GB GPU (e.g. RTX 4090 / A5000), quantized needs
less. Larger models want multi-GPU.

## 3. Wiring the driver

```ts
// in extract(), case 'vision':
const b64 = buffer.toString('base64');
const res = await fetch(`${process.env.OCR_BASE_URL}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: process.env.OCR_MODEL,
    messages: [{ role: 'user', content: [
      { type: 'text', text: EXTRACTION_PROMPT },           // see below
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${b64}` } },
    ]}],
    temperature: 0,
    response_format: { type: 'json_object' },
  }),
});
// parse JSON -> { fields: { <key>: { value, confidence } } }
```

**Extraction prompt (sketch).** Pass the model the exact field keys + Persian labels and demand
strict JSON:

> «از این تصویر سند بیمه، فقط فیلدهای زیر را استخراج کن و به‌صورت JSON برگردان. برای هر فیلد
> مقدار و یک عدد اطمینان بین ۰ تا ۱ بده. اگر فیلدی در سند نبود آن را خالی بگذار. تاریخ‌ها را شمسی
> بنویس. کلیدها: national_code (کد ملی)، death_date (تاریخ فوت)، payable_amount (مبلغ قابل
> پرداخت)، …»

Return shape: `{ "national_code": {"value":"…","confidence":0.93}, … }`.

**On confidence:** a model's self-reported confidence is only a rough signal. For something more
reliable, use vLLM token logprobs for the field tokens, or run the extraction twice and treat
disagreement as low confidence. Either way, confidence only *prioritizes human review*; it never
auto-commits a field.

## 4. Keep it in shadow mode

Do not enable any auto-accept. The platform already requires a human to confirm every value, and
the deterministic validators (کد ملی checksum, شبا checksum, مبلغ ≤ سرمایه, dates) run on confirm.
Start by letting OCR only pre-fill blanks; measure first, trust later.

## 5. Measurement harness

You don't need a separate labeling project — the system's **provenance data is the ground truth**.
Every field records whether its value came from OCR, was OCR then corrected, or was typed manually,
plus who confirmed it.

**One small addition makes this exact:** retain the model's original suggestion even after a human
edits it. Add to `ClaimFieldValue`:

```prisma
ocrValue      String?  // the model's original suggestion (kept for measurement)
ocrConfidence Float?
```

Then accuracy per field type is a direct query over real cases:

- **Field was OCR-drafted and confirmed unchanged** → OCR correct.
- **Field was OCR-drafted and then edited** (`source = OCR_CORRECTED`, `ocrValue != value`) → OCR
  wrong; you can see by how much.
- Group by field `type` and by confidence bucket to get: exact-match accuracy, accuracy at
  confidence ≥ 0.9, and the share of fields that still needed correction (operator effort saved).

A nightly job (or a `GET /claim-fields/ocr-accuracy` report) rolls these up per insurer and per
field type, so you can turn on higher trust only for the field types that prove reliable on your
real paperwork.

Ask me to add the `ocrValue` retention and the accuracy report when the model is ready, and I'll
wire the driver and the harness together.

## 6. Checklist to go live

1. Stand up the inference server (vLLM + Qwen2.5-VL) on-prem; set `OCR_BASE_URL`, `OCR_MODEL`.
2. Implement the `vision` driver branch + extraction prompt; set `OCR_DRIVER=vision`.
3. Add `ocrValue`/`ocrConfidence` retention + the accuracy report.
4. Run shadow mode for a few weeks on real documents; review the accuracy report.
5. Optionally raise trust (e.g. pre-check high-confidence non-critical fields) — never for
   amounts, کد ملی, or شبا.
