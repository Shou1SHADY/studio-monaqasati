import { FirebaseClientProvider } from "@/firebase/client-provider"

// The order link needs no sign-in, but its registration card opens the phone sign-in, which needs the Firebase provider.
export default function OrderLinkLayout({ children }: { children: React.ReactNode }) {
  return <FirebaseClientProvider>{children}</FirebaseClientProvider>
}
