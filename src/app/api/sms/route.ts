import { NextResponse } from "next/server";
import { sendSms, isSmsConfigured } from "@/lib/sms";

export async function POST(req: Request) {
  try {
    const { to, body } = await req.json();

    if (!to || !body) {
      return NextResponse.json({ error: "Missing 'to' or 'body'" }, { status: 400 });
    }

    if (!isSmsConfigured()) {
      return NextResponse.json({ success: true, skipped: true, message: "SMS skipped — Twilio credentials not configured" }, { status: 200 });
    }

    const result = await sendSms({ to, body });
    if (!result.sent) {
      return NextResponse.json({ error: result.error || "Failed to send SMS" }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Internal SMS API Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
