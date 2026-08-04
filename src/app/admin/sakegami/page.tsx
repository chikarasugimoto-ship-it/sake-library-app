import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { SakegamiSync } from "./SakegamiSync";

export const dynamic = "force-dynamic";

export default async function SakegamiPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  return <SakegamiSync />;
}
