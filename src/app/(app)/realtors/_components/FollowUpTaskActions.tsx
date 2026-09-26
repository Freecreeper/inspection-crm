"use client";

import { useRouter } from "next/navigation";
import { TaskActions } from "./TaskActions";

export function FollowUpTaskActions({ taskId, dueAt }: { taskId: string; dueAt: string | null }) {
  const router = useRouter();
  return <TaskActions taskId={taskId} dueAt={dueAt} size="xs" onDone={() => router.refresh()} />;
}
