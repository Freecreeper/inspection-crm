import { redirect } from "next/navigation";

// Appearance moved under Settings.
export default function AccountAppearanceRedirect() {
  redirect("/settings/appearance");
}
