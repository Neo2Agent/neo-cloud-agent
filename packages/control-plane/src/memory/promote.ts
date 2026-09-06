import {
  MEMORY_ERROR_CODE,
  memoryErrorMessage,
  type MemoryItem,
  type MemoryPromoteTarget,
} from "@neo-cloud-agent/contracts";
import { appendUserRuleLine } from "../accounts/accounts.js";
import { getProject, memberRole, updateProject } from "../projects/store.js";
import { canManageProject } from "@neo-cloud-agent/contracts";
import { findUserMemory, MemoryServiceError, removeUserMemory } from "./service.js";

export async function promoteUserMemory(input: {
  userId: string;
  email: string;
  id: string;
  target: MemoryPromoteTarget;
  mode?: "move" | "copy";
  projectId?: string;
}): Promise<{ memory: MemoryItem; target: MemoryPromoteTarget; mode: "move" | "copy" }> {
  const item = await findUserMemory(input.userId, input.id);
  const mode = input.mode === "copy" ? "copy" : "move";
  if (input.target === "user") {
    await appendUserRuleLine(input.userId, item.text);
  } else if (input.target === "project") {
    const projectId = (input.projectId ?? "").trim();
    if (!projectId) {
      throw new MemoryServiceError(
        MEMORY_ERROR_CODE.PROJECT_REQUIRED,
        400,
        memoryErrorMessage(MEMORY_ERROR_CODE.PROJECT_REQUIRED),
      );
    }
    const project = getProject(projectId);
    if (!project || !memberRole(projectId, input.userId)) {
      throw new MemoryServiceError(MEMORY_ERROR_CODE.NOT_FOUND, 404, "项目不存在或不是成员");
    }
    if (!canManageProject(memberRole(projectId, input.userId))) {
      throw new MemoryServiceError(MEMORY_ERROR_CODE.NOT_FOUND, 403, "没有权限改项目指令");
    }
    const instruction = [project.instruction.trim(), item.text.trim()].filter(Boolean).join("\n");
    updateProject(projectId, { instruction }, { userId: input.userId, email: input.email });
  } else {
    throw new MemoryServiceError(MEMORY_ERROR_CODE.QUERY_REQUIRED, 400, "target 只能是 user 或 project");
  }
  if (mode === "move") {
    await removeUserMemory(input.userId, input.id);
  }
  return { memory: item, target: input.target, mode };
}
