"use client";

type DeleteRecordButtonProps = {
  action: (formData: FormData) => void | Promise<void>;
  moduleTitle: string;
  recordId: string;
};

export default function DeleteRecordButton({
  action,
  moduleTitle,
  recordId,
}: DeleteRecordButtonProps) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `Permanently delete this record from ${moduleTitle}? This cannot be undone. Related records may block deletion or be unlinked. Archive instead if you need to preserve history.`,
        );
        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <input name="recordId" type="hidden" value={recordId} />
      <button className="button button-danger" type="submit">Delete permanently</button>
    </form>
  );
}
