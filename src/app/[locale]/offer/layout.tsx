import { FirebaseClientProvider } from "@/firebase/client-provider"

export default function GuestOfferLayout({ children }: { children: React.ReactNode }) {
  return <FirebaseClientProvider>{children}</FirebaseClientProvider>
}
