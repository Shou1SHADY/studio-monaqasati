import { xlsx } from './xfile';
import type { XlsxCell } from './xfile';

export const MATERIALS_TEMPLATE_FILE = 'Mdmak-Materials-Template.xlsx';
export const MATERIALS_TEMPLATE_SHEET = 'المواد';
export const MATERIALS_HOW_SHEET = 'طريقة التعبئة';

const HEADER = ['المادة / Material', 'المقاس أو المواصفة / Size or spec', 'الكمية / Qty', 'الوحدة / Unit', 'ملاحظة / Note'];
export const MATERIALS_UNITS: readonly string[] = ['م³', 'م²', 'طن', 'كجم', 'كيس', 'حبة', 'متر', 'متر طولي', 'لفة', 'برميل', 'لتر', 'نقلة'];
const HOW_BOLD = [0, 8, 15];
const HOW: string[][] = [
  ['قالب مدماك لاستيراد المواد إلى طلب عروض أسعار — Mdmak materials import template'],
  ['1. صف لكل مادة في ورقة «المواد». لا تغيّر صف العناوين. — One material per row on the “المواد” sheet. Keep the header row.'],
  ['2. المادة باسمها المعروف: حديد تسليح، بلوك، اسمنت… — The material by its usual name: rebar, block, cement…'],
  ['3. المقاس أو المواصفة في عمودها: 16 مم، 20×20×40، C30. — Size or spec in its column: 16 mm, 20×20×40, C30.'],
  ['4. الكمية رقم فقط. — The quantity is a number only.'],
  ['5. الوحدة من القائمة المنسدلة، أو اتركها فتُعتمد وحدة المادة. — Pick the unit from the list, or leave it and the material’s unit is used.'],
  ['6. الملاحظة لا تُستورد. — Notes are not imported.'],
  [''],
  ['مثال — Example'],
  ['حديد تسليح | 16 مم | 12 | طن'],
  ['بلوك اسمنتي مفرغ | 20×20×40 | 3000 | حبة'],
  ['خرسانة جاهزة | C30 | 85 | م³'],
  ['شبك حديد |  | 40 |'],
  [''],
  [''],
  ['الوحدات — Units'],
  ['م³ · م² · طن · كيس · حبة · متر · متر طولي · لفة · برميل · لتر · نقلة'],
];

export function buildMaterialsTemplate(): Uint8Array {
  const rows: XlsxCell[][] = [HEADER];
  return xlsx([
    { name: MATERIALS_TEMPLATE_SHEET, rtl: true, freeze: true, widths: [40, 26, 12, 14, 30], bold: [0], rows, list: { ref: 'D2:D1000', items: [...MATERIALS_UNITS] } },
    { name: MATERIALS_HOW_SHEET, rtl: true, widths: [92], boldTx: HOW_BOLD, rows: HOW },
  ]);
}
