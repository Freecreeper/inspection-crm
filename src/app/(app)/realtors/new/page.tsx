import { redirect } from "next/navigation";

// Adding a realtor happens in a modal on the directory now; this route
// stays so old links and bookmarks still land somewhere sensible.
export default function NewRealtorPage() {
  redirect("/realtors?new=1");
}
