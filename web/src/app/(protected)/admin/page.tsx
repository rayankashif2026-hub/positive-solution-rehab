import { hasRole, requireRole } from "@/lib/auth";
import {
  inviteAccount,
  rejectAccessRequest,
  setAccountStatus,
} from "@/app/(protected)/admin/actions";
import { RemoveAccountButton } from "@/app/(protected)/admin/remove-account-button";

type AdminPageProps = {
  searchParams: Promise<{
    error?: string;
    invited?: string;
    updated?: string;
    requestInvited?: string;
    requestRejected?: string;
    accountRemoved?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  "invalid-invite": "Check the account name, email, role, and department.",
  "developer-role-restricted": "Developer accounts are managed through the one-time bootstrap process.",
  "department-required": "Select a department for this clinic role.",
  "role-department-mismatch": "Select the department matching the selected role.",
  "invite-failed": "The account invitation could not be sent. Check the email and Supabase Auth configuration.",
  "invalid-status": "The requested account status is invalid.",
  "self-status-change": "You cannot change your own account status.",
  "invalid-remove-target": "The account selected for removal is invalid.",
  "self-remove-restricted": "You cannot remove your own Developer account.",
  "developer-account-restricted": "Developer accounts are managed through the one-time bootstrap process.",
  "account-not-found": "That account no longer exists.",
  "invalid-request": "The access request is invalid.",
  "request-not-pending": "That access request has already been reviewed.",
};

function relationValue(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    return (value[0] as Record<string, unknown> | undefined) ?? null;
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const { client, profile } = await requireRole("developer");
  const canManage = await hasRole("developer");
  const [{ data: profiles, error: profilesError }, { data: grants, error: grantsError },
    { data: roles, error: rolesError }, { data: departments, error: departmentsError },
    { data: accessRequests, error: requestsError }] = await Promise.all([
    client.from("profiles")
      .select("id,username,full_name,email,account_status,created_at")
      .order("full_name")
      .limit(500),
    client.from("user_roles")
      .select("user_id,role:roles(name,label),department:departments(name)")
      .limit(1000),
    client.from("roles").select("id,name,label").neq("name", "developer").order("label"),
    client.from("departments").select("id,name").order("name"),
    client.from("access_requests")
      .select("id,full_name,email,branch,requested_role,reason,created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(100),
  ]);
  if (
    profilesError ||
    grantsError ||
    rolesError ||
    departmentsError ||
    requestsError
  ) {
    const loadError =
      profilesError ?? grantsError ?? rolesError ?? departmentsError ?? requestsError;
    if (loadError) {
      throw new Error(`Could not load user administration: ${loadError.message}`);
    }
  }

  const grantsByUser = new Map<string, string[]>();
  const developerUserIds = new Set<string>();
  for (const grant of grants ?? []) {
    const role = relationValue(grant.role);
    const department = relationValue(grant.department);
    if (role?.name === "developer") {
      developerUserIds.add(grant.user_id);
    }
    const label = [
      String(role?.label ?? "Unassigned role"),
      department?.name ? String(department.name) : "All departments",
    ].join(" · ");
    const current = grantsByUser.get(grant.user_id) ?? [];
    current.push(label);
    grantsByUser.set(grant.user_id, current);
  }

  const {
    error,
    invited,
    updated,
    requestInvited,
    requestRejected,
    accountRemoved,
  } = await searchParams;
  const message = error
    ? errorMessages[error] ?? "The account action could not be completed."
    : invited
      ? "Invitation sent. The staff member must open the link and set a password before signing in."
      : requestInvited
        ? "The request was approved. The person can now sign in with the email and password they registered."
        : requestRejected
          ? "The access request was rejected."
          : accountRemoved
            ? "The portal account and access grants were removed. Clinic records and audit history were retained."
      : updated
        ? "Account status updated."
        : null;

  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">ACCESS CONTROL</div>
          <h1>User administration</h1>
          <p>Invite staff and manage access without sharing or storing passwords.</p>
        </div>
      </header>
      {message && <div className={error ? "alert" : "notice"} role="status">{message}</div>}

      {canManage && (
        <section className="panel">
          <h2>Invite a staff account</h2>
          <form action={inviteAccount} className="form-grid">
            <label className="field">
              Username
              <input autoComplete="off" maxLength={32} minLength={3} name="username" required />
            </label>
            <label className="field">
              Full name
              <input autoComplete="name" maxLength={120} name="fullName" required />
            </label>
            <label className="field">
              Email
              <input autoComplete="email" maxLength={254} name="email" required type="email" />
            </label>
            <label className="field">
              Role
              <select defaultValue="" name="roleId" required>
                <option disabled value="">Choose a role</option>
                {(roles ?? []).map((role) => (
                  <option key={role.id} value={role.id}>{role.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Department
              <select defaultValue="" name="departmentId">
                <option value="">All departments (Head Admin only)</option>
                {(departments ?? []).map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </select>
              <span className="muted">Choose the department matching the selected role.</span>
            </label>
            <div className="form-actions">
              <span className="muted">
                Only Head Developers can manage accounts. Invited Head Admin and department roles
                cannot access this page.
              </span>
              <button className="button button-primary" type="submit">Send invitation</button>
            </div>
          </form>
        </section>
      )}

      {canManage && (
        <section className="panel">
          <h2>Pending access requests</h2>
          <p className="muted">
            Requests do not grant access. Review the details, choose an authorized role, then approve
            the request or reject it.
          </p>
          <div className="table-wrap">
            <table className="data-table access-request-table">
              <thead>
                <tr>
                  <th>Requester</th>
                  <th>Branch</th>
                  <th>Requested role</th>
                  <th>Reason</th>
                  <th>Submitted</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {(accessRequests ?? []).map((request) => {
                  const suggestedUsername = request.email
                    .split("@")[0]
                    .toLowerCase()
                    .replace(/[^a-z0-9._-]/g, "")
                    .slice(0, 32);
                  return (
                    <tr key={request.id}>
                      <td>
                        {request.full_name}
                        <br />
                        <span className="muted">{request.email}</span>
                      </td>
                      <td>{request.branch}</td>
                      <td>{request.requested_role}</td>
                      <td>{request.reason}</td>
                      <td>{new Date(request.created_at).toLocaleString()}</td>
                      <td>
                        <form action={inviteAccount} className="form-grid">
                          <input name="requestId" type="hidden" value={request.id} />
                          <label className="field">
                            Username
                            <input
                              autoComplete="off"
                              defaultValue={suggestedUsername.length >= 3 ? suggestedUsername : "staff.user"}
                              maxLength={32}
                              minLength={3}
                              name="username"
                              required
                            />
                          </label>
                          <label className="field">
                            Approved role
                            <select defaultValue="" name="roleId" required>
                              <option disabled value="">Choose a role</option>
                              {(roles ?? []).map((role) => (
                                <option key={role.id} value={role.id}>{role.label}</option>
                              ))}
                            </select>
                          </label>
                          <label className="field">
                            Department
                            <select defaultValue="" name="departmentId">
                              <option value="">All departments (Head Admin only)</option>
                              {(departments ?? []).map((department) => (
                                <option key={department.id} value={department.id}>{department.name}</option>
                              ))}
                            </select>
                          </label>
                          <button className="button button-primary" type="submit">Approve request</button>
                        </form>
                        <form action={rejectAccessRequest} className="inline-form" style={{ marginTop: 8 }}>
                          <input name="requestId" type="hidden" value={request.id} />
                          <button className="button" type="submit">Reject</button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
                {!accessRequests?.length && (
                  <tr><td className="empty-state" colSpan={6}>No pending access requests.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Staff accounts</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Email</th>
                <th>Role and department</th>
                <th>Status</th>
                {canManage && <th>Account action</th>}
              </tr>
            </thead>
            <tbody>
              {(profiles ?? []).map((account) => (
                <tr key={account.id}>
                  <td>{account.full_name}</td>
                  <td>{account.username}</td>
                  <td>{account.email}</td>
                  <td>{(grantsByUser.get(account.id) ?? ["No assigned role"]).join(", ")}</td>
                  <td>{account.account_status.replaceAll("_", " ")}</td>
                  {canManage && (
                    <td>
                      {account.id !== profile.id && (
                      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
                        <form action={setAccountStatus} className="inline-form">
                          <input name="userId" type="hidden" value={account.id} />
                          <select
                            aria-label={`Status for ${account.full_name}`}
                            defaultValue={account.account_status}
                            name="status"
                          >
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                            <option value="locked">Locked</option>
                          </select>
                          <button className="button" type="submit">Update</button>
                        </form>
                        {!developerUserIds.has(account.id) && (
                          <RemoveAccountButton fullName={account.full_name} userId={account.id} />
                        )}
                      </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {!profiles?.length && (
                <tr><td className="empty-state" colSpan={canManage ? 6 : 5}>No accounts found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
