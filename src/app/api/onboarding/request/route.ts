import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAdminFirestore } from '@/lib/firebaseAdmin'

const schema = z.object({
  name: z.string().trim().min(2),
  company: z.string().trim().min(2),
  phone: z.string().trim().min(7),
  email: z.string().trim().email(),
  locale: z.string().optional(),
})

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: true, message: 'Invalid input' }, { status: 400 })
    }

    const db = getAdminFirestore()
    await db.collection('onboardingRequests').add({
      ...parsed.data,
      status: 'new',
      createdAt: new Date().toISOString(),
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Onboarding request error:', err)
    return NextResponse.json({ error: true, message: 'Server error' }, { status: 500 })
  }
}
