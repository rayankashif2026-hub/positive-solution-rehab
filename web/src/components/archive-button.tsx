"use client";

type ArchiveButtonProps = {
  action: (formData: FormData) => void | Promise<void>;
  recordId: string;
};

export default function ArchiveButton({ action, recordId }: ArchiveButtonProps) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm("Archive this record? It will be hidden from active lists.")) {
          event.preventDefault();
        }
      }}
    >
      <input name="recordId" type="hidden" value={recordId} />
      <button className="button button-danger" type="submit">Archive</button>
    </form>
  );
}
