/** Register only while edits exist; browsers choose their own confirmation text. */
export function protectUnsavedChanges(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  dirty: boolean,
) {
  if (!dirty) return () => {};
  const handler = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = "";
  };
  target.addEventListener("beforeunload", handler);
  return () => target.removeEventListener("beforeunload", handler);
}
