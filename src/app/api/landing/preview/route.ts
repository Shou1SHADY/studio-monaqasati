import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

const AVATAR_BGS = [
  'linear-gradient(135deg,#0d5c6a,#07303c)',
  'linear-gradient(135deg,#0d4a30,#072a1a)',
  'linear-gradient(135deg,#0d3e5c,#07222f)',
  'linear-gradient(135deg,#3d175c,#1f072f)',
  'linear-gradient(135deg,#5c3d17,#2f1e07)',
  'linear-gradient(135deg,#0d3a5c,#072040)',
];

function avatarBg(initial: string): string {
  const code = (initial || '').charCodeAt(0) || 0;
  return AVATAR_BGS[code % AVATAR_BGS.length];
}

function firstInitial(name?: string): string {
  if (!name) return '؟';
  for (const ch of name) {
    if (ch.trim()) return ch;
  }
  return '؟';
}

export async function GET() {
  try {
    const db = getAdminFirestore();

    // ── Fetch latest active RFQ with its top offers ──────────────────────────
    const rfqsSnap = await db.collection('rfqs')
      .where('status', '==', 'New')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    let rfq = null;
    if (!rfqsSnap.empty) {
      const rfqDoc = rfqsSnap.docs[0];
      const r = rfqDoc.data();

      const offersSnap = await db.collection('offers')
        .where('rfqId', '==', rfqDoc.id)
        .orderBy('price', 'asc')
        .limit(3)
        .get();

      const topOffers = offersSnap.docs.map(o => {
        const data = o.data();
        const name = data.supplierName || data.organizationName || '؟';
        return {
          initial: firstInitial(name),
          bg: avatarBg(firstInitial(name)),
          price: Number(data.price) || 0,
        };
      });

      const deadlineMs = r.deadline
        ? new Date(r.deadline).getTime() - Date.now()
        : 86400000;

      rfq = {
        id: rfqDoc.id.slice(-4).toUpperCase(),
        category: r.category || r.categoryId || '',
        subCategory: r.subCategory || '',
        quantity: String(r.quantity || ''),
        unit: r.unitOfMeasure || '',
        offersCount: r.offersCount ?? topOffers.length,
        deadlineMs: Math.max(0, deadlineMs),
        topOffers,
      };
    }

    // ── Fetch recent active projects ──────────────────────────────────────────
    const projectsSnap = await db.collection('projects')
      .orderBy('createdAt', 'desc')
      .limit(3)
      .get();

    const pctMap = [80, 60, 45];
    const projects = projectsSnap.docs.map((doc, i) => {
      const d = doc.data();
      const type = d.projectType || d.category || d.type || '';
      const region = d.region || d.location || '';
      const rawStatus = d.status === 'completed' ? 'completed' : d.status === 'paused' ? 'pending' : 'active';
      return {
        id: doc.id,
        type,
        region,
        pct: pctMap[i] ?? 50,
        ok: i === 0,
        status: rawStatus,
        statusOk: rawStatus === 'completed',
        color: ['#20CBD5', '#0EA5E9', '#F59E0B'][i] ?? '#20CBD5',
      };
    });

    // ── Fetch verified suppliers ──────────────────────────────────────────────
    const suppliersSnap = await db.collection('users')
      .where('role', '==', 'Supplier')
      .limit(3)
      .get();

    const suppliers = suppliersSnap.docs.map(doc => {
      const d = doc.data();
      const name = d.companyName || d.name || '؟';
      const initial = firstInitial(name);
      const cat = d.specializations?.[0] || d.category || '';
      return {
        id: doc.id,
        initial,
        category: cat,
        bg: avatarBg(initial),
      };
    });

    // ── Total supplier count ──────────────────────────────────────────────────
    let supplierCount = suppliers.length;
    try {
      const countAgg = await db.collection('users').where('role', '==', 'Supplier').count().get();
      supplierCount = countAgg.data().count;
    } catch {
      // count() may not be available in all Admin SDK versions — use list length
    }

    return NextResponse.json(
      { rfq, projects, suppliers, supplierCount },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } }
    );
  } catch (err) {
    console.error('Landing preview error:', err);
    return NextResponse.json({ rfq: null, projects: [], suppliers: [], supplierCount: 0 });
  }
}
