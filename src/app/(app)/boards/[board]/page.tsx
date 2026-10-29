import { notFound, redirect } from "next/navigation";
import { isBoardId } from "@/lib/boards/catalog";
import { BoardPage } from "../BoardPage";

// A section's board (/boards/inspections …). Overview lives at /dashboard.
export default async function SectionBoardPage({ params }: PageProps<"/boards/[board]">) {
  const { board } = await params;
  if (board === "overview") redirect("/dashboard");
  if (!isBoardId(board)) notFound();
  return <BoardPage board={board} />;
}
