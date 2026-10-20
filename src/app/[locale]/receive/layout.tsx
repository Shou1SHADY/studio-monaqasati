import { FirebaseClientProvider } from "@/firebase/client-provider"

// The receiver's link page knows who is signed in: the member a delivery was forwarded to
// confirms with his own sign-in instead of a texted code (PUR-06). A guest needs no account.
export default function ReceiveLayout({ children }: { children: React.ReactNode }) {
  return <FirebaseClientProvider>{children}</FirebaseClientProvider>
}
