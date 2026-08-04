import { redirect } from "next/navigation";
import { isOwner, isAdmin } from "@/lib/auth";
import { StaffManager } from "./StaffManager";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  if (!(await isOwner())) redirect("/admin"); // 管理者(杉本)以外は入れない
  return <StaffManager />;
}
