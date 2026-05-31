import { redirect } from "next/navigation";

// Root → aplikacja (podsumowania). Stary landing marketingowy jest w historii gita.
export default function RootPage() {
  redirect("/summarize");
}
