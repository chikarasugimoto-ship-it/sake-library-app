import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { get } from "@/lib/db";
import { MascotStudio } from "./MascotStudio";

export const dynamic = "force-dynamic";

export default async function MascotPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const cur = await get<{ value: string }>("SELECT value FROM settings WHERE key = 'mascot_url'");
  return <MascotStudio currentUrl={cur?.value || ""} />;
}
