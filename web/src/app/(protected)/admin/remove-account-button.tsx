"use client";

import { removeAccount } from "./actions";

type RemoveAccountButtonProps = {
  fullName: string;
  userId: string;
};

export function RemoveAccountButton({ fullName, userId }: RemoveAccountButtonProps) {
  return (
    <form
      action={removeAccount}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `Remove ${fullName}'s portal account and access grants? Clinic records and audit history will be retained.`,
        );
        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <input name="userId" type="hidden" value={userId} />
      <button className="button button-danger" type="submit">
        Remove
      </button>
    </form>
  );
}
