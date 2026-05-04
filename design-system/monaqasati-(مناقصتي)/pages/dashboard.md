# Dashboard Page Overrides

> **PROJECT:** Monaqasati (مناقصتي)
> **Generated:** 2026-05-04
> **Page Type:** Dashboard / Data View
> **Source:** UX Design Article - "6 steps to design thoughtful dashboards for B2B SaaS"

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Key Improvements Applied (Based on Article)

### 1. Data Freshness Indicators (Article: "Omitting timestamps")
- Added "آخر تحديث" timestamp in header
- Shows relative time (e.g., "منذ 5 دقائق", "منذ 2 ساعة")
- Helps users trust the data

### 2. Contextual Metrics (Article: "Showing numbers without context")
- Added context text under each KPI (e.g., "قائمة للمراجعة", "منذ بداية العام")
- Added trend indicators with percentage changes (up/down arrows)
- Helps users understand what the numbers mean for them

### 3. Insights Section - First Fold (Article: "5 Second Rule")
- Added "أبرز اللمسات" section above stats
- Shows opportunities, alerts, and successes
- Prioritized by impact - users can find key info within 5 seconds

### 4. Progressive Disclosure (Article: "Overloading the dashboard")
- Primary KPIs in first fold
- Additional metrics available through expandable section
- Respects user's time - shows what's important first

### 5. Actionable Layout (Article: "Data narrative")
- All activity items are clickable links
- Added clear CTAs ("عرض والتفاوض", "مراجعة الآن")
- Follows scanning pattern (top-left to bottom-right in RTL)

### 6. Enhanced Commitment Score (Article: "Presenting data without logical order")
- Added breakdown metrics (معدل الرد، العقود المكتملة)
- Added visual progress bar
- More context about what the score means

---

## Page-Specific Rules

### Layout Overrides
- **Max Width:** 1200px (standard)
- **Layout:** Full-width sections, centered content
- **First Fold Priority:** Insights + Primary KPIs (4 stats)

### Spacing Overrides
- No overrides — use Master spacing

### Typography Overrides
- No overrides — use Master typography

### Color Overrides
- No overrides — use Master colors

### Component Overrides
- Enhanced stats with trend indicators and context
- Added insights cards (opportunity/alert/success types)
- Added accessibility labels to SVGs

---

## Recommendations

### Effects Applied
- Number animations (count-up) - via CSS transitions
- Trend direction indicators (green up, red down arrows)
- Percentage change badges
- Data freshness timestamps
- Progress bars in commitment score

### Accessibility
- Added aria-labels to all key visualizations
- Respects prefers-reduced-motion
- Color is not the only indicator (icons + labels)
- Proper heading hierarchy

### Performance
- Memoized queries and computations
- Efficient re-renders with useMemo
- Lazy loading of expanded sections