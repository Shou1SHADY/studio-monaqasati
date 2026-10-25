export const PROC_SOON_NOTIFY = "procSoonNotify"
export type SoonTopic = "bnpl"

export const soonNotifyId = (uid: string, topic: SoonTopic) => `${uid}__${topic}`

export async function askToBeNotified(idToken: string, topic: SoonTopic): Promise<boolean> {
  try {
    const res = await fetch("/api/procurement/soon-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ topic }),
    })
    return res.ok
  } catch {
    return false
  }
}
