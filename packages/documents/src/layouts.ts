import {
  DOCUMENT_LABELS,
  formatDocumentDate,
  formatMoney,
  type DocumentModel,
  type FireReportDocument,
  type IncidentReportDocument,
  type InvoiceDocument,
  type PoliceReportDocument,
} from '@demo/shared';
import { printable } from './text.js';

/**
 * V16 page layouts (pdfmake document definitions): what a broker would really receive — an
 * invoice with its issuer and lines, a form-like incident report, a police receipt, a fire
 * brigade report. Every printed string goes through `printable` (standard PDF fonts).
 */

type Content = Record<string, unknown> | string | Content[];
const GREY = '#6b7280';
const LINE = '#d1d5db';
const PAGE_WIDTH = 595.28 - 2 * 48;

const p = (text: string, style: Record<string, unknown> = {}): Content => ({
  text: printable(text),
  ...style,
});

/** A labelled value on one line ("Label : value"), the label small and grey as on a form. */
function field(label: string, value: string, width: number | string = '*'): Content {
  return {
    width,
    text: [
      { text: printable(`${label} : `), fontSize: 8, color: GREY },
      { text: printable(value || '—'), fontSize: 10 },
    ],
    margin: [0, 1, 0, 1],
  };
}

/** A framed block with a title bar. */
function box(title: string, body: Content[]): Content {
  return {
    table: {
      widths: ['*'],
      body: [
        [p(title, { bold: true, fontSize: 8, color: '#ffffff', fillColor: '#374151' })],
        [{ stack: body, margin: [2, 4, 2, 4] }],
      ],
    },
    layout: {
      hLineColor: () => '#9ca3af',
      vLineColor: () => '#9ca3af',
      hLineWidth: () => 0.6,
      vLineWidth: () => 0.6,
    },
    margin: [0, 0, 0, 8],
  };
}

/** A form checkbox: a small framed cell, with an X when ticked (read as "X Label"). */
function checkbox(label: string, checked: boolean): Content {
  return {
    columns: [
      {
        width: 12,
        table: {
          widths: [6],
          heights: [6],
          body: [[p(checked ? 'X' : ' ', { fontSize: 6, bold: true, alignment: 'center' })]],
        },
        layout: {
          hLineWidth: () => 0.8,
          vLineWidth: () => 0.8,
          paddingLeft: () => 0,
          paddingRight: () => 0,
          paddingTop: () => 0,
          paddingBottom: () => 0,
        },
      },
      p(label, { fontSize: 9 }),
    ],
    margin: [0, 1, 0, 1],
  };
}

/** A hatched grey rectangle where a value cannot be read (scenario 9). */
function unreadable(label: string, width = 110, height = 14): Content {
  const hatches = [];
  for (let x = -height; x < width; x += 6) {
    hatches.push({
      type: 'line',
      x1: Math.max(0, x),
      y1: x < 0 ? -x : 0,
      x2: Math.min(width, x + height),
      y2: x + height > width ? height - (x + height - width) : height,
      lineWidth: 0.6,
      lineColor: '#9ca3af',
    });
  }
  return {
    stack: [
      {
        canvas: [{ type: 'rect', x: 0, y: 0, w: width, h: height, color: '#e5e7eb' }, ...hatches],
      },
      p(label, { fontSize: 6, italics: true, color: GREY }),
    ],
  };
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}

function invoiceLayout(model: InvoiceDocument): Content[] {
  const l = DOCUMENT_LABELS[model.language];
  const money = (value: number) => formatMoney(value, model.language);
  const date = (value: string) => formatDocumentDate(value, model.language);
  const header: Content = {
    columns: [
      {
        width: 46,
        stack: [
          {
            canvas: [{ type: 'ellipse', x: 20, y: 20, r1: 20, r2: 20, color: model.issuer.color }],
          },
          p(initials(model.issuer.name), {
            bold: true,
            color: '#ffffff',
            fontSize: 13,
            relativePosition: { x: 0, y: -29 },
            alignment: 'center',
            width: 40,
          }),
        ],
      },
      {
        width: '*',
        stack: [
          p(model.issuer.name.toUpperCase(), { bold: true, fontSize: 13 }),
          ...model.issuer.address.map((line) => p(line, { fontSize: 9 })),
          p(`${model.issuer.phone} — ${model.issuer.email}`, { fontSize: 9, color: GREY }),
        ],
      },
      {
        width: 190,
        stack: [
          p(model.kind === 'invoice' ? l.invoice : l.quote, {
            bold: true,
            fontSize: 20,
            alignment: 'right',
            color: model.issuer.color,
          }),
          p(`${l.number} ${model.number}`, { alignment: 'right', fontSize: 10 }),
          p(`${l.date} : ${date(model.date)}`, { alignment: 'right', fontSize: 10 }),
          ...(model.validUntil
            ? [
                p(`${l.validUntil} : ${date(model.validUntil)}`, {
                  alignment: 'right',
                  fontSize: 9,
                }),
              ]
            : []),
        ],
      },
    ],
    columnGap: 10,
  };
  const client: Content = {
    columns: [
      { width: '*', text: '' },
      {
        width: 230,
        table: {
          widths: ['*'],
          body: [
            [
              {
                stack: [
                  p(l.client, { fontSize: 7, color: GREY }),
                  p(model.client.name, { bold: true }),
                  ...model.client.address.map((line) => p(line, { fontSize: 9 })),
                ],
                margin: [6, 4, 6, 4],
              },
            ],
          ],
        },
        layout: { hLineColor: () => LINE, vLineColor: () => LINE },
      },
    ],
    margin: [0, 18, 0, 12],
  };
  const rows: Content[][] = [
    [l.designation, l.quantity, l.unitPrice, l.lineTotal].map((title) =>
      p(title, { bold: true, fontSize: 9, fillColor: '#f3f4f6' }),
    ),
    ...model.lines.map((line) => [
      p(line.label, { fontSize: 9 }),
      p(String(line.quantity), { fontSize: 9, alignment: 'right' }),
      line.unitPrice === null
        ? unreadable(l.unreadable, 60, 10)
        : p(money(line.unitPrice), { fontSize: 9, alignment: 'right' }),
      line.unitPrice === null
        ? unreadable(l.unreadable, 60, 10)
        : p(money(Math.round(line.unitPrice * line.quantity * 100) / 100), {
            fontSize: 9,
            alignment: 'right',
          }),
    ]),
  ];
  const total = (label: string, value: string, bold = false): Content[] => [
    p(label, { fontSize: 10, bold }),
    p(value, { fontSize: 10, bold, alignment: 'right' }),
  ];
  const totals: Content = {
    columns: [
      { width: '*', text: '' },
      {
        width: 220,
        table: {
          widths: ['*', 90],
          body: model.totals
            ? [
                total(l.net, money(model.totals.net)),
                total(l.vat, money(model.totals.vat)),
                total(l.gross, money(model.totals.gross), true),
              ]
            : [
                [p(l.net, { fontSize: 10 }), unreadable(l.unreadable, 90)],
                [p(l.gross, { fontSize: 10, bold: true }), unreadable(l.unreadable, 90)],
              ],
        },
        layout: 'lightHorizontalLines',
      },
    ],
    margin: [0, 10, 0, 0],
  };
  return [
    header,
    client,
    p(`${l.subject} : ${model.subject}`, { fontSize: 10, margin: [0, 0, 0, 8] }),
    {
      table: { headerRows: 1, widths: ['*', 40, 80, 80], body: rows },
      layout: {
        hLineColor: () => LINE,
        vLineColor: () => LINE,
        paddingTop: () => 4,
        paddingBottom: () => 4,
      },
    },
    totals,
    {
      stack: [
        p(l.payment, { fontSize: 8, color: GREY }),
        p(`${l.iban} ${model.iban}`, { fontSize: 8, color: GREY }),
        p(
          `${model.issuer.name} — ${l.siret} ${model.issuer.siret} — ${l.vatNumber} ${model.issuer.vatNumber}`,
          { fontSize: 8, color: GREY },
        ),
      ],
      margin: [0, 40, 0, 0],
    },
  ];
}

function incidentLayout(model: IncidentReportDocument): Content[] {
  const l = DOCUMENT_LABELS[model.language];
  const date = (value: string) => formatDocumentDate(value, model.language);
  const title =
    model.variant === 'water'
      ? l.waterTitle
      : model.variant === 'vehicle'
        ? l.vehicleTitle
        : l.statementTitle;
  const insured = box(l.insured, [
    { columns: [field(l.insured, model.insured.name), field(l.siren, model.insured.siren, 110)] },
    {
      columns: [
        field(l.address, model.insured.address.join(', ')),
        field(l.policy, model.insured.policyNumber ?? '', 110),
      ],
      margin: [0, 4, 0, 0],
    },
  ]);
  const when = box(`${l.incidentDate} / ${l.location}`, [
    {
      columns: [
        model.date
          ? field(l.incidentDate, date(model.date), 150)
          : field(l.incidentDate, l.notFilled, 150),
        field(l.time, model.time ?? '', 60),
        field(l.location, model.location),
      ],
    },
  ]);
  const vehicles =
    model.vehicle &&
    box(`${l.vehicleA} / ${l.vehicleB}`, [
      {
        columns: [
          {
            stack: [
              p(l.vehicleA, { bold: true, fontSize: 9 }),
              field(l.plate, model.vehicle.plate),
              field(l.model, model.vehicle.model),
            ],
          },
          {
            stack: [
              p(l.vehicleB, { bold: true, fontSize: 9 }),
              field(l.plate, '—'),
              field(l.model, '—'),
            ],
          },
        ],
        columnGap: 16,
      },
    ]);
  const boxes = box(l.circumstances, [
    {
      columns: [model.options.slice(0, 2), model.options.slice(2)].map((column) => ({
        stack: column.map((option) => checkbox(option, model.checked.includes(option))),
      })),
    },
  ]);
  const sketch =
    model.variant === 'vehicle' &&
    box(l.sketch, [
      {
        canvas: [
          {
            type: 'rect',
            x: 0,
            y: 0,
            w: PAGE_WIDTH - 12,
            h: 90,
            lineColor: LINE,
            dash: { length: 4 },
          },
          { type: 'line', x1: 20, y1: 45, x2: PAGE_WIDTH - 32, y2: 45, lineColor: '#9ca3af' },
        ],
      },
    ]);
  return [
    p(title, { fontSize: 15, bold: true, alignment: 'center', margin: [0, 0, 0, 12] }),
    insured,
    when,
    ...(vehicles ? [vehicles] : []),
    boxes,
    ...(sketch ? [sketch] : []),
    { text: '', pageBreak: 'after' },
    box(l.circumstances, [p(model.circumstances, { fontSize: 10 })]),
    box(l.damages, [p(model.damages, { fontSize: 10 })]),
    {
      columns: [field(l.signature, model.signedBy), field(l.madeOn, date(model.signedOn), 150)],
      margin: [0, 20, 0, 0],
    },
    {
      canvas: [
        { type: 'line', x1: 0, y1: 30, x2: 180, y2: 30, lineWidth: 0.6, lineColor: '#111827' },
      ],
    },
  ];
}

function stamp(label: string): Content {
  return {
    stack: [
      {
        canvas: [
          { type: 'ellipse', x: 45, y: 45, r1: 42, r2: 42, lineWidth: 2, lineColor: '#9ca3af' },
          { type: 'ellipse', x: 45, y: 45, r1: 34, r2: 34, lineWidth: 0.8, lineColor: '#9ca3af' },
        ],
      },
      p(label, {
        fontSize: 7,
        color: '#9ca3af',
        alignment: 'center',
        width: 90,
        relativePosition: { x: 0, y: -52 },
      }),
    ],
    width: 90,
  };
}

function policeLayout(model: PoliceReportDocument): Content[] {
  const l = DOCUMENT_LABELS[model.language];
  const date = (value: string | null) =>
    value ? formatDocumentDate(value, model.language) : l.notFilled;
  return [
    p(l.policeAuthority, { fontSize: 9, bold: true, color: '#1e3a8a' }),
    p(model.office, { fontSize: 9, color: GREY, margin: [0, 0, 0, 16] }),
    p(l.policeTitle, { fontSize: 15, bold: true, alignment: 'center' }),
    p(`${l.procedure} : ${model.procedureNumber}`, { alignment: 'center', margin: [0, 2, 0, 16] }),
    box(l.complainant, [
      p(`${l.complainant} : ${model.complainant}, ${l.acting} ${model.company}`, { fontSize: 10 }),
    ]),
    box(l.offence, [
      { columns: [field(l.offence, model.offence), field(l.factsDate, date(model.date), 150)] },
      { columns: [field(l.location, model.location)], margin: [0, 4, 0, 0] },
    ]),
    box(
      l.stolen,
      model.stolenItems.map((item) => p(`• ${item}`, { fontSize: 10 })),
    ),
    {
      columns: [
        p(`${l.registeredOn} ${date(model.registeredOn)}`, { fontSize: 10, margin: [0, 30, 0, 0] }),
        stamp(l.stamp),
      ],
      margin: [0, 20, 0, 0],
    },
  ];
}

function fireLayout(model: FireReportDocument): Content[] {
  const l = DOCUMENT_LABELS[model.language];
  const date = (value: string | null) =>
    value ? formatDocumentDate(value, model.language) : l.notFilled;
  return [
    {
      columns: [
        {
          width: 40,
          canvas: [
            {
              type: 'polyline',
              closePath: true,
              color: '#dc2626',
              points: [
                { x: 18, y: 0 },
                { x: 34, y: 30 },
                { x: 18, y: 38 },
                { x: 2, y: 30 },
              ],
            },
          ],
        },
        {
          stack: [
            p(model.service, { bold: true, fontSize: 11, color: '#b91c1c' }),
            p(l.fireTitle, { bold: true, fontSize: 15 }),
          ],
        },
      ],
      margin: [0, 0, 0, 14],
    },
    box(l.intervention, [
      {
        columns: [
          field(l.intervention, model.interventionNumber, 150),
          field(l.interventionDate, date(model.date), 150),
          field(l.address, model.address),
        ],
      },
      {
        columns: [
          field(l.call, model.times.call, 150),
          field(l.arrival, model.times.arrival, 150),
          field(l.end, model.times.end),
        ],
        margin: [0, 4, 0, 0],
      },
    ]),
    box(
      l.means,
      model.means.map((item) => p(`• ${item}`, { fontSize: 10 })),
    ),
    box(l.nature, [p(model.nature, { fontSize: 10 })]),
    box(l.observations, [p(model.observations, { fontSize: 10 })]),
    p(`${l.officer} : ${model.officer}`, { fontSize: 10, margin: [0, 16, 0, 0] }),
  ];
}

export function documentContent(model: DocumentModel): Content[] {
  switch (model.kind) {
    case 'invoice':
    case 'quote':
      return invoiceLayout(model);
    case 'incident_report':
      return incidentLayout(model);
    case 'police_report':
      return policeLayout(model);
    case 'fire_report':
      return fireLayout(model);
  }
}
