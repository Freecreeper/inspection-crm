import { BoardPage } from "../boards/BoardPage";

// Overview: the home board. Rendered per request, so a newly scheduled
// inspection, a paid invoice or a completed task shows on the next load.
export default function DashboardPage() {
  return <BoardPage board="overview" />;
}
