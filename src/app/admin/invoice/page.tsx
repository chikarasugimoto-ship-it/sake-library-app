import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { InvoiceScan } from "./InvoiceScan";

export const dynamic = "force-dynamic";

export default async function InvoicePage() {
  if (!(await isAdmin())) redirect("/admin/login");
  return <InvoiceScan />;
}
