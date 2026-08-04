import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { LinkStatus } from "./LinkStatus";

export const dynamic = "force-dynamic";

export default async function SmaregiPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  return <LinkStatus />;
}
