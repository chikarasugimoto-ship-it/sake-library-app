import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { SettingsForm } from "./SettingsForm";
import { RepricePanel } from "./RepricePanel";
import { CostPanel } from "./CostPanel";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  return (
    <>
      <SettingsForm />
      <CostPanel />
      <RepricePanel />
    </>
  );
}
