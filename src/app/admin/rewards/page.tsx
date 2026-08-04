import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { RedeemForm } from "./RedeemForm";

export const dynamic = "force-dynamic";

export default async function RewardsPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  return <RedeemForm />;
}
