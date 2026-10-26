import { xlsx } from './xfile';
import type { XlsxCell } from './xfile';

export const BOQ_TEMPLATE_FILE = 'Mdmak-BOQ-Template.xlsx';
export const BOQ_TEMPLATE_SHEET = 'جدول الكميات';
export const BOQ_HOW_SHEET = 'طريقة التعبئة';
export const BOQ_UNITS = ['م³', 'م²', 'م.ط', 'م', 'طن', 'كجم', 'عدد', 'مقطوعية', 'مبلغ احتياطي', 'نقطة', 'لتر', 'يوم', 'شهر', '%'];

const ROWS = 500;
const HEAD = ['رقم البند / Item', 'وصف البند / Description', 'الوحدة / Unit', 'الكمية / Qty', 'سعر الوحدة / Rate', 'الإجمالي / Amount', 'ملاحظات / Notes'];
const HOW = [
  'قالب مدماك لجدول الكميات — Mdmak bill of quantities template',
  '1. صف لكل بند في ورقة «جدول الكميات»، ولا تغيّر صف العناوين. — One item per row on the “جدول الكميات” sheet; keep the header row.',
  '2. عنوان الباب أو القسم: سطر فيه رقمه واسمه فقط بلا كمية (مثل: 01 · الأعمال الخرسانية)، وبنوده تحته. — A division or section heading: a row with its code and name only, no quantity; its items below it.',
  '3. مثال بند: 01-01 · خرسانة عادية للنظافة C15 · م³ · 22 · 230 — Example item: 01-01 · Plain concrete blinding C15 · m³ · 22 · 230',
  '4. الوحدة من القائمة المنسدلة أو تُكتب، والكمية رقم (عربي أو إنجليزي). — Pick the unit from the list or type it; the quantity is a number (Arabic or Western digits).',
  '5. سعر الوحدة اختياري: الجدول بلا أسعار يُقبل ويُسعَّر لاحقاً، والإجمالي يُحسب وحده. — The rate is optional: an unpriced BOQ is accepted and priced later; the amount calculates itself.',
  '6. المقطوع: الوحدة «مقطوعية» والكمية 1. والمبلغ الاحتياطي: الوحدة «مبلغ احتياطي» والمبلغ في عمود الإجمالي. — Lump sum: unit “مقطوعية”, quantity 1. Provisional sum: unit “مبلغ احتياطي”, the amount in the amount column.',
  '7. لا تكتب سطور المجاميع ولا الضريبة: النظام يجمع البنود ويطابقها بقيمة الترسية. — Do not add total or VAT rows: the system adds up the items and reconciles them with the award value.',
  '8. ورقة لكل باب جائزة، بصف العناوين نفسه في أول كل ورقة. — A sheet per division is fine, with the same header row at the top of each sheet.',
  '9. القالب اختياري: أي جدول كميات يُرفع كما وصلك. — The template is optional: any BOQ can be uploaded as you received it.',
];

export function buildBoqTemplate(): Uint8Array {
  const rows: XlsxCell[][] = [HEAD];
  for (let r = 2; r <= ROWS + 1; r++) rows.push(['', '', '', '', '', { f: `IF(AND(ISNUMBER(D${r}),ISNUMBER(E${r})),D${r}*E${r},"")` }, '']);
  return xlsx([
    { name: BOQ_TEMPLATE_SHEET, rtl: true, freeze: true, widths: [14, 64, 12, 12, 14, 16, 26], bold: [0], rows, list: { ref: `C2:C${ROWS + 1}`, items: BOQ_UNITS } },
    { name: BOQ_HOW_SHEET, rtl: true, widths: [120], boldTx: [0], rows: HOW.map(x => [x]) },
  ]);
}
