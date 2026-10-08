// Generates the demo document set: a fictional Indian home-textile exporter and seven
// fictional US buyers. Every company, person, bank, vessel and address here is invented.
// Run: npm run demo:generate   (writes ./demo)

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'demo');

const EXPORTER = {
  name: 'Kaveri Looms Pvt Ltd',
  address: ['14/2 Mill Road, Karur 639002', 'Tamil Nadu, India'],
  iec: 'AAHCK4412M',
  gstin: '33AAHCK4412M1Z5',
  email: 'senthil@kaveriloom.example',
  signatory: 'R. Senthil Kumar',
  title: 'Director',
};

const fmt = (n, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtQ = (n) => n.toLocaleString('en-US');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dmy = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')}-${MON[m - 1]}-${y}`;
};

// ---------------------------------------------------------------------------------------
// Buyers and their documents

const BUYERS = [
  {
    slug: 'brightwater',
    name: 'Brightwater Home Supply Inc.',
    address: ['1200 Raritan Center Pkwy', 'Edison, NJ 08837, USA'],
    domain: 'brightwaterhome.example',
    contact: 'Dana Whitfield',
    contactTitle: 'Director of Sourcing',
    profile: { revenueSharePct: 22, relationshipSinceYear: 2014, openOrders: true },
    incoterm: 'FOB Tuticorin',
    port: 'Tuticorin (INTUT1)',
    invoices: [
      { no: 'KL/EX/25-26/097', date: '2025-06-18', bl: '2025-06-24', po: 'BW-4390', sb: '3982214', items: [['Cotton bath towels 70x140 cm', '6302.60.0020', 18000, 'PCS', 6.4], ['Cotton hand towels 40x70 cm', '6302.60.0020', 20000, 'PCS', 2.2]] },
      { no: 'KL/EX/25-26/118', date: '2025-08-22', bl: '2025-08-28', po: 'BW-4471', sb: '4417823', items: [['Cotton bath towels 70x140 cm', '6302.60.0020', 16000, 'PCS', 5.1], ['Cotton hand towels 40x70 cm', '6302.60.0020', 20000, 'PCS', 1.75]] },
      { no: 'KL/EX/25-26/124', date: '2025-09-30', bl: '2025-10-06', po: 'BW-4502', sb: '4630118', items: [['Cotton bath towels 70x140 cm', '6302.60.0020', 18000, 'PCS', 5.1], ['Cotton hand towels 40x70 cm', '6302.60.0020', 22000, 'PCS', 1.75]] },
      { no: 'KL/EX/25-26/131', date: '2025-11-14', bl: '2025-11-20', po: 'BW-4538', sb: '4871306', items: [['Cotton bath towels 70x140 cm', '6302.60.0020', 17500, 'PCS', 5.1], ['Cotton hand towels 40x70 cm', '6302.60.0020', 20000, 'PCS', 1.75]] },
      { no: 'KL/EX/25-26/142', date: '2026-01-06', bl: '2026-01-12', po: 'BW-4581', sb: '5126640', items: [['Cotton bath towels 70x140 cm', '6302.60.0020', 15000, 'PCS', 5.1], ['Cotton hand towels 40x70 cm', '6302.60.0020', 18000, 'PCS', 1.75]] },
    ],
    email: {
      date: 'Tue, 12 Aug 2025 09:42:00 -0400',
      subject: 'RE: Pricing support - reciprocal tariff on India',
      body: [
        'Senthil,',
        '',
        'Thanks for the call yesterday. Confirming what we agreed:',
        '',
        'With the 25% reciprocal tariff on Indian goods in force from August 7 and the further 25% duty announced for August 27, our landed cost on your towels goes up by half. To keep the program on shelf we need you to carry part of that duty.',
        '',
        'Revised FOB prices, effective for PO BW-4471 and all later shipments (invoices KL/EX/25-26/118, KL/EX/25-26/124 and KL/EX/25-26/131):',
        '',
        '- Bath towels 70x140 (HS 6302.60): from USD 6.40 to USD 5.10 per pc',
        '- Hand towels 40x70 (HS 6302.60): from USD 2.20 to USD 1.75 per pc',
        '',
        'Please reflect these on the invoices. We will revisit once the tariff situation settles.',
        '',
        'Best,',
        'Dana Whitfield',
        'Director of Sourcing, Brightwater Home Supply Inc.',
        '1200 Raritan Center Pkwy, Edison, NJ 08837',
        '',
        '> On Mon, 11 Aug 2025, R. Senthil Kumar wrote:',
        '> Dana, we understand the pressure. We can support you on price for the next shipments.',
      ],
      from: 'buyer',
    },
    bank: { type: 'ebrc-csv', invoices: ['KL/EX/25-26/097', 'KL/EX/25-26/118', 'KL/EX/25-26/124', 'KL/EX/25-26/131'] },
  },
  {
    slug: 'cedar-finch',
    name: 'Cedar & Finch Living LLC',
    address: ['410 Westbrook Ave, Suite 300', 'Charlotte, NC 28202, USA'],
    domain: 'cedarfinch.example',
    contact: 'Marcus Lyle',
    contactTitle: 'VP Merchandising',
    profile: { revenueSharePct: 9, relationshipSinceYear: 2019, openOrders: true },
    incoterm: 'CIF Charleston',
    port: 'Chennai (INMAA1)',
    freight: true,
    invoices: [
      { no: 'KL/EX/25-26/121', date: '2025-08-20', bl: '2025-08-26', po: 'CF-2207', sb: '4402871', freight: 3200, insurance: 260, items: [['Cotton kitchen towels 50x70 cm, 2-pack', '6302.91.0045', 30000, 'PCS', 3.8]] },
      { no: 'KL/EX/25-26/129', date: '2025-10-10', bl: '2025-10-16', po: 'CF-2241', sb: '4719520', freight: 3000, insurance: 240, items: [['Cotton kitchen towels 50x70 cm, 2-pack', '6302.91.0045', 28000, 'PCS', 3.8]] },
      { no: 'KL/EX/25-26/137', date: '2025-12-05', bl: '2025-12-11', po: 'CF-2290', sb: '5012384', freight: 2900, insurance: 200, items: [['Cotton kitchen towels 50x70 cm, 2-pack', '6302.91.0045', 26000, 'PCS', 3.1]] },
    ],
    email: {
      date: 'Tue, 02 Sep 2025 16:05:00 -0400',
      subject: 'Tariff cost sharing - credit note on open invoices',
      body: [
        'Hi Senthil,',
        '',
        'The additional 25% duty on Indian-origin goods that took effect on August 27 has put the kitchen textile line under real margin pressure. Following our discussion, this is what we agreed:',
        '',
        '1. Kitchen towels 2-pack (HS 6302.91): the price moves from USD 3.80 to USD 3.10 per pc CIF Charleston.',
        '2. For goods already shipped, you will issue a credit note of USD 0.70 per pc against invoices KL/EX/25-26/121 and KL/EX/25-26/129, and we will short-pay those invoices by the credit amount.',
        '3. New orders from PO CF-2290 will be invoiced at USD 3.10.',
        '',
        'Appreciate you sharing this burden with us.',
        '',
        'Regards,',
        'Marcus Lyle',
        'VP Merchandising | Cedar & Finch Living LLC',
      ],
      from: 'buyer',
    },
    bank: { type: 'fira-pdf', invoices: ['KL/EX/25-26/121', 'KL/EX/25-26/129'], credit: 0.7 },
  },
  {
    slug: 'palisade',
    name: 'Palisade Hospitality Linens Corp',
    address: ['3900 W Sunset Rd', 'Las Vegas, NV 89118, USA'],
    domain: 'palisadelinens.example',
    contact: 'Rita Okafor',
    contactTitle: 'Procurement Manager',
    profile: { revenueSharePct: 15, relationshipSinceYear: 2017, openOrders: false },
    incoterm: 'FOB Chennai',
    port: 'Chennai (INMAA1)',
    listPrice: true,
    invoices: [
      { no: 'KL/EX/25-26/115', date: '2025-08-14', bl: '2025-08-19', po: 'PHL-88120', sb: '4381906', items: [['Percale bed sheet set, queen', '6302.31.9010', 9000, 'SETS', 12.0, 14.5], ['Pillow cases, standard, pair', '6302.31.9020', 12000, 'PCS', 2.0, 2.4]] },
      { no: 'KL/EX/25-26/127', date: '2025-10-06', bl: '2025-10-11', po: 'PHL-88174', sb: '4688235', items: [['Percale bed sheet set, queen', '6302.31.9010', 8000, 'SETS', 12.0, 14.5], ['Pillow cases, standard, pair', '6302.31.9020', 10000, 'PCS', 2.0, 2.4]] },
    ],
    email: {
      date: 'Mon, 11 Aug 2025 11:20:00 -0700',
      subject: 'Tariff support discount from next shipment',
      body: [
        'Senthil,',
        '',
        'As discussed, given the new reciprocal tariff on imports from India, we will need a tariff support discount on the hotel program until further notice.',
        '',
        'Queen sheet sets: from USD 14.50 to USD 12.00 per set',
        'Pillow cases: from USD 2.40 to USD 2.00 per pc',
        '',
        'Please show the list price and the net price on each invoice so our finance team can track the discount.',
        '',
        'Thanks,',
        'Rita Okafor',
        'Procurement Manager, Palisade Hospitality Linens Corp',
      ],
      from: 'buyer',
    },
    bank: { type: 'ebrc-pdf', invoices: ['KL/EX/25-26/115'] },
  },
  {
    slug: 'northgate',
    name: 'Northgate Retail Group Inc.',
    address: ['77 Polaris Pkwy', 'Columbus, OH 43240, USA'],
    domain: 'northgateretail.example',
    contact: 'Ben Carrow',
    contactTitle: 'Senior Buyer, Home',
    profile: { revenueSharePct: 6, relationshipSinceYear: 2021, openOrders: true },
    incoterm: 'FOB Tuticorin',
    port: 'Tuticorin (INTUT1)',
    invoices: [
      { no: 'KL/EX/25-26/104', date: '2025-07-10', bl: '2025-07-16', po: 'NG-55102', sb: '4104772', items: [['Cotton bath sheets 90x160 cm', '6302.60.0030', 12000, 'PCS', 4.6]] },
      { no: 'KL/EX/25-26/123', date: '2025-09-25', bl: '2025-10-01', po: 'NG-55190', sb: '4611092', items: [['Cotton bath sheets 90x160 cm', '6302.60.0030', 11500, 'PCS', 4.05]] },
      { no: 'KL/EX/25-26/135', date: '2025-11-28', bl: '2025-12-04', po: 'NG-55233', sb: '4950177', items: [['Cotton bath sheets 90x160 cm', '6302.60.0030', 12000, 'PCS', 4.05]] },
    ],
    email: {
      date: 'Thu, 04 Sep 2025 14:10:00 -0400',
      subject: 'Q4 pricing - bath sheets',
      body: [
        'Senthil,',
        '',
        'Looking at Q4. With the bigger volume we are planning on bath sheets and with the new tariffs on Indian goods now at 50%, we need you to sharpen the price.',
        '',
        'Bath sheets 90x160: from USD 4.60 to USD 4.05 per pc, effective from PO NG-55190.',
        '',
        'Let me know if you can confirm by Friday.',
        '',
        'Ben Carrow',
        'Senior Buyer, Home | Northgate Retail Group Inc.',
      ],
      from: 'buyer',
    },
  },
  {
    slug: 'marisol',
    name: 'Marisol Kitchen Co.',
    address: ['2250 NW 72nd Ave', 'Miami, FL 33122, USA'],
    domain: 'marisolkitchen.example',
    contact: 'Lucia Ferrer',
    contactTitle: 'Owner',
    profile: { revenueSharePct: 4, relationshipSinceYear: 2020, openOrders: null },
    transitDays: 24,
    incoterm: 'CFR Miami',
    port: 'Cochin (INCOK1)',
    freightIncluded: true,
    invoices: [
      { no: 'KL/EX/25-26/119', date: '2025-08-18', bl: '2025-08-20', po: 'MK-0915', sb: '4396105', freightIncl: 2400, items: [['Cotton kitchen towels, waffle weave', '6302.91.0045', 20000, 'PCS', 2.35]] },
      { no: 'KL/EX/25-26/140', date: '2026-01-08', bl: '2026-01-14', po: 'MK-1002', sb: '5098513', freightIncl: 2600, items: [['Cotton kitchen towels, waffle weave', '6302.91.0045', 22000, 'PCS', 2.35]] },
    ],
    email: {
      date: 'Mon, 11 Aug 2025 10:05:00 -0400',
      subject: 'New tariff - pricing for kitchen towels',
      body: [
        'Dear Senthil,',
        '',
        'With the 25% tariff on Indian goods from August 7 we cannot hold the retail price without your help. Can we agree the waffle kitchen towels from USD 2.80 to USD 2.35 per pc CFR Miami, starting with the August shipment?',
        '',
        'Gracias,',
        'Lucia Ferrer',
        'Marisol Kitchen Co.',
      ],
      from: 'buyer',
    },
  },
  {
    slug: 'kestrel-bay',
    name: 'Kestrel Bay Trading Inc.',
    address: ['1 Embarcadero West, Suite 210', 'Oakland, CA 94607, USA'],
    domain: 'kestrelbay.example',
    contact: 'Owen Park',
    contactTitle: 'Import Manager',
    profile: { revenueSharePct: 7, relationshipSinceYear: 2018, openOrders: true },
    incoterm: 'FOB Chennai',
    port: 'Chennai (INMAA1)',
    invoices: [
      { no: 'KL/EX/25-26/120', date: '2025-08-19', bl: '2025-08-29', po: 'KB-3318', sb: '4405519', items: [['Cotton chindi bath mats 50x80 cm', '5705.00.2030', 15000, 'PCS', 3.2]] },
      { no: 'KL/EX/25-26/133', date: '2025-11-20', bl: '2025-11-26', po: 'KB-3360', sb: '4902266', items: [['Cotton chindi bath mats 50x80 cm', '5705.00.2030', 16000, 'PCS', 3.2]] },
    ],
    email: {
      date: 'Fri, 29 Aug 2025 08:30:00 -0700',
      subject: 'Bath mats - price for shipments under the 50% duty',
      body: [
        'Senthil,',
        '',
        'Now that the extra 25% duty is in force from August 27 our duty on your bath mats is 50%. To keep the program running we need to share that cost.',
        '',
        'Chindi bath mats 50x80: from USD 3.90 to USD 3.20 per pc FOB Chennai, for invoice KL/EX/25-26/120 and later orders.',
        '',
        'Owen Park',
        'Import Manager, Kestrel Bay Trading Inc.',
      ],
      from: 'buyer',
    },
    refund: { date: '2026-06-26', principal: 49600.0, interest: 1642.18, ref: 'CAPE-2026-0418-77213', entries: ['KBX-1188420-5', 'KBX-1190377-1'] },
  },
  {
    slug: 'bluestem',
    name: 'Bluestem Outfitters LLC',
    address: ['815 Washington Ave N', 'Minneapolis, MN 55401, USA'],
    domain: 'bluestemoutfitters.example',
    contact: 'Hannah Voss',
    contactTitle: 'Buying Director',
    profile: { revenueSharePct: 5, relationshipSinceYear: 2022, openOrders: true },
    incoterm: 'DDP Minneapolis',
    port: 'Tuticorin (INTUT1)',
    invoices: [
      { no: 'KL/EX/25-26/125', date: '2025-10-02', bl: '2025-10-08', po: 'BO-7714', sb: '4651830', items: [['Cotton beach towels 90x180 cm', '6302.60.0020', 9000, 'PCS', 7.1]] },
      { no: 'KL/EX/25-26/138', date: '2025-12-12', bl: '2025-12-18', po: 'BO-7760', sb: '5040712', items: [['Cotton beach towels 90x180 cm', '6302.60.0020', 8000, 'PCS', 7.1]] },
    ],
  },
];

// ---------------------------------------------------------------------------------------
// PDF helpers

async function newPdf() {
  const pdf = await PDFDocument.create();
  pdf.setProducer('ClawBack demo generator');
  pdf.setCreator('ClawBack');
  const page = pdf.addPage([595, 842]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  return { pdf, page, font, bold };
}

function txt(ctx, s, x, y, size = 9, b = false, color = rgb(0.1, 0.1, 0.12)) {
  ctx.page.drawText(String(s), { x, y, size, font: b ? ctx.bold : ctx.font, color });
}
function right(ctx, s, xr, y, size = 9, b = false) {
  const w = (b ? ctx.bold : ctx.font).widthOfTextAtSize(String(s), size);
  txt(ctx, s, xr - w, y, size, b);
}
function hr(ctx, y, x1 = 40, x2 = 555) {
  ctx.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.6, color: rgb(0.55, 0.55, 0.6) });
}

async function invoicePdf(buyer, inv) {
  const c = await newPdf();
  let y = 800;
  txt(c, EXPORTER.name.toUpperCase(), 40, y, 14, true);
  right(c, 'COMMERCIAL INVOICE', 555, y, 13, true);
  y -= 14;
  txt(c, EXPORTER.address[0], 40, y);
  y -= 11;
  txt(c, EXPORTER.address[1], 40, y);
  y -= 11;
  txt(c, `IEC: ${EXPORTER.iec}   GSTIN: ${EXPORTER.gstin}`, 40, y);
  y -= 10;
  hr(c, y);
  y -= 16;
  const rows = [
    [`Invoice No: ${inv.no}`, `Invoice Date: ${dmy(inv.date)}`],
    [`Buyer's PO No: ${inv.po}`, `Shipping Bill No: ${inv.sb}`],
    [`Terms of Delivery: ${buyer.incoterm}`, 'Currency: USD'],
    [`B/L Date: ${dmy(inv.bl)}`, `Port of Loading: ${buyer.port}`],
    ['Vessel: MV Coromandel Star', 'Payment Terms: 60 days from B/L'],
  ];
  for (const [a, b] of rows) {
    txt(c, a, 40, y);
    txt(c, b, 320, y);
    y -= 13;
  }
  y -= 6;
  txt(c, 'Buyer:', 40, y, 9, true);
  txt(c, 'Consignee:', 320, y, 9, true);
  y -= 12;
  txt(c, buyer.name, 40, y);
  txt(c, 'Same as buyer', 320, y);
  y -= 11;
  txt(c, buyer.address[0], 40, y);
  y -= 11;
  txt(c, buyer.address[1], 40, y);
  y -= 12;
  hr(c, y);
  y -= 14;
  const lp = !!buyer.listPrice;
  const X = lp ? { sl: 40, desc: 58, hs: 228, qty: 330, unit: 340, list: 425, price: 475, amt: 555 } : { sl: 40, desc: 58, hs: 248, qty: 360, unit: 370, price: 465, amt: 555 };
  txt(c, 'Sl', X.sl, y, 8.5, true);
  txt(c, 'Description of Goods', X.desc, y, 8.5, true);
  txt(c, 'HS Code', X.hs, y, 8.5, true);
  right(c, 'Qty', X.qty, y, 8.5, true);
  txt(c, 'Unit', X.unit, y, 8.5, true);
  if (lp) right(c, 'List Price', X.list, y, 8.5, true);
  right(c, lp ? 'Net Price' : 'Unit Price', X.price, y, 8.5, true);
  right(c, 'Amount (USD)', X.amt, y, 8.5, true);
  y -= 6;
  hr(c, y);
  y -= 13;
  let total = 0;
  inv.items.forEach(([desc, hs, qty, unit, price, list], i) => {
    const amt = Math.round(qty * price * 100) / 100;
    total += amt;
    txt(c, `${i + 1}`, X.sl, y);
    txt(c, desc, X.desc, y);
    txt(c, hs, X.hs, y);
    right(c, fmtQ(qty), X.qty, y);
    txt(c, unit, X.unit, y);
    if (lp) right(c, fmt(list), X.list, y);
    right(c, fmt(price), X.price, y);
    right(c, fmt(amt), X.amt, y);
    y -= 14;
  });
  y -= 2;
  hr(c, y, 300);
  y -= 13;
  if (inv.freight) {
    right(c, 'Total FOB value', 470, y);
    right(c, fmt(total), 555, y);
    y -= 13;
    right(c, 'Ocean freight', 470, y);
    right(c, fmt(inv.freight), 555, y);
    y -= 13;
    right(c, 'Insurance', 470, y);
    right(c, fmt(inv.insurance), 555, y);
    y -= 13;
    total += inv.freight + inv.insurance;
  }
  right(c, `Invoice Total (USD)`, 470, y, 9, true);
  right(c, fmt(total), 555, y, 9, true);
  y -= 22;
  if (inv.freightIncl) {
    txt(c, `Prices are CFR; ocean freight of USD ${fmt(inv.freightIncl)} is included in the unit prices.`, 40, y);
    y -= 12;
  }
  if (lp) {
    txt(c, 'Net price includes the tariff support discount agreed in your email of 11-Aug-2025.', 40, y);
    y -= 12;
  }
  txt(c, 'Declaration: We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.', 40, y, 7.5);
  y -= 40;
  txt(c, `For ${EXPORTER.name}`, 380, y);
  y -= 30;
  txt(c, 'Authorised Signatory', 380, y);
  return { bytes: await c.pdf.save(), total };
}

async function firaPdf(buyer, inv, invTotal, credit, qty, n) {
  const c = await newPdf();
  let y = 800;
  txt(c, 'Coromandel Commercial Bank Ltd', 40, y, 13, true);
  y -= 13;
  txt(c, 'Trade Finance Services, Anna Salai Branch, Chennai 600002', 40, y);
  y -= 22;
  txt(c, 'FOREIGN INWARD REMITTANCE ADVICE (FIRA)', 40, y, 11, true);
  y -= 22;
  const realised = Math.round((invTotal - credit * qty) * 100) / 100;
  const inr = Math.round(realised * 88.42 * 100) / 100;
  const date = n === 0 ? '2025-11-03' : '2025-12-22';
  const rows = [
    ['FIRA No:', `CCB/FIRA/2025/${8812 + n * 37}`],
    ['Beneficiary:', EXPORTER.name],
    ['Remitter Name:', buyer.name],
    ['Remitter Bank:', 'First Harbor National Bank, Charlotte NC'],
    ['IRM No:', `IRM${2025110300}${n}`],
    ['Date of Realisation:', dmy(date)],
    ['Export Invoice No:', inv.no],
    ['Currency:', 'USD'],
    ['Amount Realised (FCY):', fmt(realised)],
    ['INR Equivalent:', fmt(inr)],
    ['Exchange Rate:', '88.42'],
    ['Purpose Code:', 'P0102 - Realisation of export bills'],
    ['Remarks:', `Short payment of USD ${fmt(credit * qty)} against credit note for tariff cost sharing`],
  ];
  for (const [a, b] of rows) {
    txt(c, a, 40, y, 9.5, true);
    txt(c, b, 200, y, 9.5);
    y -= 16;
  }
  y -= 20;
  txt(c, 'This is a system generated advice and does not require a signature.', 40, y, 8);
  return c.pdf.save();
}

async function ebrcPdf(buyer, inv, total) {
  const c = await newPdf();
  let y = 800;
  txt(c, 'ELECTRONIC BANK REALISATION CERTIFICATE (e-BRC)', 40, y, 12, true);
  y -= 14;
  txt(c, 'Generated from the DGFT e-BRC system (demo copy)', 40, y, 8.5);
  y -= 24;
  const rows = [
    ['e-BRC No:', 'CCBK0412520251107003'],
    ['IEC:', EXPORTER.iec],
    ['Exporter Name:', EXPORTER.name],
    ['Bank Name:', 'Coromandel Commercial Bank Ltd'],
    ['Shipping Bill No:', inv.sb],
    ['Shipping Bill Date:', dmy(inv.bl)],
    ['Invoice No:', inv.no],
    ['Buyer Name:', buyer.name],
    ['Date of Realisation:', '07-Nov-2025'],
    ['Currency:', 'USD'],
    ['Realised Value in FCY:', fmt(total)],
    ['Realised Value in INR:', fmt(Math.round(total * 88.71 * 100) / 100)],
  ];
  for (const [a, b] of rows) {
    txt(c, a, 40, y, 9.5, true);
    txt(c, b, 210, y, 9.5);
    y -= 16;
  }
  return c.pdf.save();
}

async function refundPdf(buyer, r) {
  const c = await newPdf();
  let y = 800;
  txt(c, 'Harborline Customs Brokerage LLC', 40, y, 13, true);
  y -= 13;
  txt(c, '500 Clay St, Oakland, CA 94607  |  Licensed customs broker', 40, y);
  y -= 26;
  txt(c, 'IEEPA DUTY REFUND - CAPE CONFIRMATION', 40, y, 11, true);
  y -= 22;
  const rows = [
    ['Importer of Record:', buyer.name],
    ['CAPE Declaration No:', r.ref],
    ['Declaration accepted:', '28-Apr-2026'],
    ['Entries covered:', r.entries.join(', ')],
    ['Country of origin:', 'India'],
    ['Refund Date:', dmy(r.date)],
    ['Refund Amount (duty):', `USD ${fmt(r.principal)}`],
    ['Interest Amount:', `USD ${fmt(r.interest)}`],
    ['Total paid by ACH:', `USD ${fmt(r.principal + r.interest)}`],
  ];
  for (const [a, b] of rows) {
    txt(c, a, 40, y, 9.5, true);
    txt(c, b, 210, y, 9.5);
    y -= 16;
  }
  y -= 16;
  txt(c, 'Prepared for our client; forwarded to the supplier at the client\'s request.', 40, y, 8.5);
  return c.pdf.save();
}

function eml(buyer, e) {
  const fromBuyer = `${buyer.contact} <${buyer.contact.toLowerCase().replace(/[^a-z]+/g, '.')}@${buyer.domain}>`;
  const toExp = `${EXPORTER.signatory} <${EXPORTER.email}>`;
  return [
    `From: ${fromBuyer}`,
    `To: ${toExp}`,
    `Date: ${e.date}`,
    `Subject: ${e.subject}`,
    `Message-ID: <${buyer.slug}.${Date.parse(e.date)}@${buyer.domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    ...e.body,
    '',
  ].join('\r\n');
}

// ---------------------------------------------------------------------------------------

async function main() {
  // Keep demo/extra (it holds pre-made scan/photo files); regenerate everything else.
  for (const entry of await fs.readdir(OUT).catch(() => [])) {
    if (entry !== 'extra') await fs.rm(path.join(OUT, entry), { recursive: true, force: true });
  }
  await fs.mkdir(OUT, { recursive: true });
  const manifest = { exporter: EXPORTER, buyers: [] };
  for (const b of BUYERS) {
    const dir = path.join(OUT, b.slug);
    await fs.mkdir(dir, { recursive: true });
    const files = [];
    const totals = {};
    for (const inv of b.invoices) {
      const { bytes, total } = await invoicePdf(b, inv);
      totals[inv.no] = { total, qty: inv.items.reduce((a, it) => a + it[2], 0), inv };
      const name = `invoice-${inv.no.split('/').pop()}.pdf`;
      await fs.writeFile(path.join(dir, name), bytes);
      files.push(name);
    }
    if (b.email) {
      const name = `price-revision-${b.slug}.eml`;
      await fs.writeFile(path.join(dir, name), eml(b, b.email));
      files.push(name);
    }
    if (b.bank?.type === 'ebrc-csv') {
      const head = 'e-BRC No,IRM No,Shipping Bill No,SB Date,Invoice No,Realisation Date,Currency,Realised Value (FCY),Realised Value (INR),Remitter Name';
      const rows = b.bank.invoices.map((no, i) => {
        const t = totals[no];
        const d = ['2025-08-29', '2025-11-04', '2025-12-15', '2026-01-28'][i];
        const rate = [87.12, 88.65, 89.9, 90.75][i];
        return [`CCBK04125${20250800 + i * 7}`, `IRM${2025090400 + i * 11}`, t.inv.sb, dmy(t.inv.bl), no, dmy(d), 'USD', t.total.toFixed(2), (t.total * rate).toFixed(2), `"${b.name}"`].join(',');
      });
      const name = `ebrc-export-${b.slug}.csv`;
      await fs.writeFile(path.join(dir, name), [head, ...rows, ''].join('\r\n'));
      files.push(name);
    }
    if (b.bank?.type === 'fira-pdf') {
      for (let i = 0; i < b.bank.invoices.length; i++) {
        const t = totals[b.bank.invoices[i]];
        const bytes = await firaPdf(b, t.inv, t.total, b.bank.credit, t.qty, i);
        const name = `fira-${t.inv.no.split('/').pop()}.pdf`;
        await fs.writeFile(path.join(dir, name), bytes);
        files.push(name);
      }
    }
    if (b.bank?.type === 'ebrc-pdf') {
      for (const no of b.bank.invoices) {
        const t = totals[no];
        const bytes = await ebrcPdf(b, t.inv, t.total);
        const name = `ebrc-${no.split('/').pop()}.pdf`;
        await fs.writeFile(path.join(dir, name), bytes);
        files.push(name);
      }
    }
    if (b.refund) {
      const bytes = await refundPdf(b, b.refund);
      const name = `cape-refund-confirmation.pdf`;
      await fs.writeFile(path.join(dir, name), bytes);
      files.push(name);
    }
    manifest.buyers.push({ name: b.name, slug: b.slug, files: files.map((f) => `${b.slug}/${f}`), profile: b.profile, transitDays: b.transitDays ?? null, contactName: b.contact, contactEmail: `${b.contact.toLowerCase().replace(/[^a-z]+/g, '.')}@${b.domain}` });
  }
  await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Extra documents for a live demo (not loaded by "Load demo workspace"):
  // a new Kestrel Bay invoice to upload live. demo/extra also holds a scanned copy and a
  // photo of it (made once from this PDF) to show Gemma reading images.
  const kb = BUYERS.find((x) => x.slug === 'kestrel-bay');
  await fs.mkdir(path.join(OUT, 'extra'), { recursive: true });
  const extra = await invoicePdf(kb, { no: 'KL/EX/25-26/139', date: '2026-01-05', bl: '2026-01-09', po: 'KB-3391', sb: '5071140', items: [['Cotton chindi bath mats 50x80 cm', '5705.00.2030', 14000, 'PCS', 3.2], ['Cotton chindi runner 60x180 cm', '5705.00.2030', 3000, 'PCS', 7.4]] });
  await fs.writeFile(path.join(OUT, 'extra', 'invoice-139-kestrel-bay.pdf'), extra.bytes);

  // A loose email to try the "paste" intake live
  await fs.writeFile(
    path.join(OUT, 'try-pasting-this-email.txt'),
    [
      'From: Owen Park <owen.park@kestrelbay.example>',
      'Date: Wed, 3 Dec 2025 10:15:00 -0800',
      'Subject: Re: mats pricing for January',
      '',
      'Senthil, the duty is still 50% so we would like to keep USD 3.20 (down from USD 3.90) for January as well.',
      'Owen Park, Import Manager, Kestrel Bay Trading Inc.',
      '',
    ].join('\n'),
  );
  console.log(`Demo documents written to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
