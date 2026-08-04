import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  return <SettingsForm />;
}
