import { notFound } from "next/navigation";

// Any /admin/... address that is not a real admin page lands here and shows the admin
// "Page not found" (src/app/admin/(panel)/not-found.tsx) instead of the store's 404.
export default function AdminMissingPage() {
  notFound();
}
