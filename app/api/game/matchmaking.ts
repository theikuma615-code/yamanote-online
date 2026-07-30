export function canResumeRandomRoom(status: string | null | undefined) {
  return status === "starting" || status === "active";
}
