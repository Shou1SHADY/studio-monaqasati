import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { to, body } = await req.json();

    if (!to || !body) {
      return NextResponse.json({ error: "Missing 'to' or 'body'" }, { status: 400 });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhone = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromPhone) {
      console.error("Missing Twilio credentials in environment variables.");
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
      },
      body: new URLSearchParams({
        To: to,
        From: fromPhone,
        Body: body,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Twilio API Error:", data);
      return NextResponse.json({ error: data.message || "Failed to send SMS" }, { status: response.status });
    }

    return NextResponse.json({ success: true, messageId: data.sid });
  } catch (error) {
    console.error("Internal SMS API Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
