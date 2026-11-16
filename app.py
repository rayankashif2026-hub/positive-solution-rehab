import os
from html import escape

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from django.contrib.auth import authenticate
from django.core.management import call_command
from django.core.exceptions import ValidationError
from django.db.models import F, Q
from django.db import transaction
from django.forms import modelform_factory
from django.http import QueryDict
from django.shortcuts import get_object_or_404
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.utils import timezone
from asgiref.sync import sync_to_async
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from clinic.models import (
    Appointment,
    BatchAttendance,
    BatchMember,
    Equipment,
    ExerciseBatch,
    InventoryItem,
    Patient,
    PhysiotherapyRecord,
    Staff,
    StaffAttendance,
)


security = HTTPBasic(auto_error=False)
app = FastAPI(title="Clinic Management System", version="1.0.0")

RESOURCES = {
    "patients": {
        "title": "Patients",
        "singular": "Patient",
        "model": Patient,
        "columns": ("name", "contact", "gender", "age", "diagnosis"),
        "search": ("name", "contact", "diagnosis"),
    },
    "staff": {
        "title": "Staff",
        "singular": "Staff member",
        "model": Staff,
        "columns": ("name", "role", "contact", "is_active"),
        "search": ("name", "role", "contact"),
    },
    "appointments": {
        "title": "Appointments",
        "singular": "Appointment",
        "model": Appointment,
        "select_related": ("patient", "staff"),
        "columns": ("appointment_date", "appointment_time", "patient", "service", "staff", "status"),
        "search": ("patient__name", "patient__contact", "service", "status"),
    },
    "physiotherapy-records": {
        "title": "Physiotherapy records",
        "singular": "Physiotherapy record",
        "model": PhysiotherapyRecord,
        "select_related": ("patient", "treated_by"),
        "columns": ("patient", "diagnosis", "treated_by", "payment_type", "followup_date",
                    "total_sessions", "sessions_done", "sessions_left"),
        "search": ("patient__name", "patient__contact", "diagnosis"),
    },
    "exercise-batches": {
        "title": "Exercise batches",
        "singular": "Exercise batch",
        "model": ExerciseBatch,
        "select_related": ("trainer",),
        "columns": ("batch_name", "start_time", "end_time", "trainer"),
        "search": ("batch_name",),
    },
    "batch-members": {
        "title": "Batch members",
        "singular": "Batch member",
        "model": BatchMember,
        "select_related": ("patient", "batch"),
        "columns": ("patient", "batch", "joined_on", "is_active"),
        "search": ("patient__name", "batch__batch_name"),
    },
    "batch-attendance": {
        "title": "Batch attendance",
        "singular": "Batch attendance",
        "model": BatchAttendance,
        "select_related": ("batch", "patient"),
        "columns": ("att_date", "batch", "patient", "present"),
        "search": ("patient__name", "batch__batch_name"),
    },
    "staff-attendance": {
        "title": "Staff attendance",
        "singular": "Staff attendance",
        "model": StaffAttendance,
        "select_related": ("staff",),
        "columns": ("att_date", "staff", "status", "time_in", "time_out"),
        "search": ("staff__name", "status"),
    },
    "inventory": {
        "title": "Inventory",
        "singular": "Inventory item",
        "model": InventoryItem,
        "columns": ("item_name", "category", "quantity", "unit", "reorder_level", "is_low"),
        "search": ("item_name", "category"),
    },
    "equipment": {
        "title": "Equipment",
        "singular": "Equipment item",
        "model": Equipment,
        "columns": ("equipment_name", "department", "qty_present", "qty_required", "qty_to_buy",
                    "condition"),
        "search": ("equipment_name", "department", "condition"),
    },
}

NAVIGATION = (
    ("patients", "Patients"),
    ("staff", "Staff"),
    ("appointments", "Appointments"),
    ("physiotherapy-records", "Physiotherapy"),
    ("exercise-batches", "Exercise batches"),
    ("batch-members", "Batch members"),
    ("batch-attendance", "Batch attendance"),
    ("staff-attendance", "Staff attendance"),
    ("inventory", "Inventory"),
    ("equipment", "Equipment"),
)


@app.on_event("startup")
async def initialize_database() -> None:
    await sync_to_async(call_command)("migrate", interactive=False, verbosity=0)


def authenticated_staff(credentials: HTTPBasicCredentials | None):
    if credentials is None:
        if not get_user_model().objects.filter(is_staff=True).exists():
            return None
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Staff login required",
            headers={"WWW-Authenticate": "Basic"},
        )
    user = authenticate(username=credentials.username, password=credentials.password)
    if user is None or not user.is_staff:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Staff login required",
            headers={"WWW-Authenticate": "Basic"},
        )
    return user


def require_staff(credentials: HTTPBasicCredentials | None = Depends(security)):
    user = authenticated_staff(credentials)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Create the first staff account at /setup",
        )
    return user


def get_resource(resource: str) -> dict:
    config = RESOURCES.get(resource)
    if config is None:
        raise HTTPException(status_code=404, detail="Page not found")
    return config


def setup_page(errors=(), username: str = "") -> HTMLResponse:
    error_html = "".join(f"<li>{escape(message)}</li>" for message in errors)
    if error_html:
        error_html = f'<ul class="errorlist">{error_html}</ul>'
    content = f"""
    <header><div><div class="eyebrow">FIRST-TIME SETUP</div><h1>Create clinic admin</h1>
      <p>Create the first staff account to protect the clinic workspace.</p></div></header>
    <section class="panel form-panel">{error_html}
      <form method="post" action="/setup">
        <p><label for="username">Username</label><input id="username" name="username"
          autocomplete="username" required value="{escape(username, quote=True)}"></p>
        <p><label for="password">Password</label><input id="password" type="password"
          name="password" autocomplete="new-password" required></p>
        <p><label for="password-confirm">Confirm password</label><input id="password-confirm"
          type="password" name="password_confirm" autocomplete="new-password" required></p>
        <div class="form-actions"><button class="button primary" type="submit">
          Create admin account</button></div>
      </form>
    </section>
    """
    return page("First-time setup", content)


@app.get("/setup", response_class=HTMLResponse)
def first_time_setup():
    if get_user_model().objects.filter(is_staff=True).exists():
        return RedirectResponse("/", status_code=303)
    return setup_page()


@app.post("/setup", response_class=HTMLResponse)
async def create_first_admin(request: Request):
    body = (await request.body()).decode("utf-8")
    return await sync_to_async(process_first_admin)(body)


def process_first_admin(body: str):
    user_model = get_user_model()
    data = QueryDict(body)
    username = data.get("username", "").strip()
    password = data.get("password", "")
    password_confirm = data.get("password_confirm", "")
    errors = []

    if user_model.objects.filter(is_staff=True).exists():
        return RedirectResponse("/", status_code=303)
    if not username:
        errors.append("Enter a username.")
    elif user_model.objects.filter(username=username).exists():
        errors.append("That username is already in use.")
    if password != password_confirm:
        errors.append("The passwords do not match.")
    if password:
        try:
            validate_password(password, user=user_model(username=username))
        except ValidationError as error:
            errors.extend(error.messages)
    else:
        errors.append("Enter a password.")

    if errors:
        return setup_page(errors, username)

    with transaction.atomic():
        if user_model.objects.filter(is_staff=True).exists():
            return RedirectResponse("/", status_code=303)
        user_model.objects.create_superuser(username=username, password=password)
    return RedirectResponse("/", status_code=303)


def page(title: str, content: str, active: str = "") -> HTMLResponse:
    nav_links = "".join(
        f'<a class="{"active" if key == active else ""}" href="/records/{key}">{escape(label)}</a>'
        for key, label in NAVIGATION
    )
    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(title)} · Clinic</title>
  <style>
    :root {{ color-scheme: light; --ink:#172b3a; --muted:#728391; --line:#e4ebee;
      --teal:#087f78; --teal-light:#e4f4f1; --canvas:#f5f8f8; }}
    * {{ box-sizing:border-box; }}
    body {{ margin:0; background:var(--canvas); color:var(--ink);
      font:15px/1.5 "Segoe UI",Arial,sans-serif; }}
    .layout {{ min-height:100vh; display:grid; grid-template-columns:245px 1fr; }}
    aside {{ background:#fff; border-right:1px solid var(--line); padding:25px 16px; }}
    .brand {{ display:flex; gap:11px; align-items:center; padding:0 10px 24px;
      margin-bottom:16px; border-bottom:1px solid var(--line); }}
    .brand-icon {{ width:40px;height:40px;border-radius:13px;background:var(--teal-light);
      display:grid;place-items:center;color:var(--teal);font-size:21px;font-weight:700; }}
    .brand strong {{ display:block;font-size:16px; }}
    .brand small,.eyebrow {{ color:var(--muted);font-size:12px; }}
    .nav-label {{ padding:9px 10px 5px;color:#99a7ae;font-size:10px;font-weight:700;
      letter-spacing:.12em;text-transform:uppercase; }}
    nav a {{ display:block;padding:9px 11px;margin:2px 0;border-radius:8px;
      color:#536573;text-decoration:none;font-size:14px; }}
    nav a:hover,nav a.active {{ background:var(--teal-light);color:var(--teal);font-weight:600; }}
    main {{ min-width:0;padding:32px clamp(18px,4vw,54px);max-width:1500px;width:100%; }}
    header {{ display:flex;align-items:flex-start;justify-content:space-between;gap:15px;
      margin-bottom:25px; }}
    h1 {{ font-size:26px;letter-spacing:-.03em;margin:0 0 3px; }}
    h2 {{ font-size:17px;margin:0 0 14px; }}
    p {{ color:var(--muted);margin:3px 0; }}
    .button {{ display:inline-flex;align-items:center;justify-content:center;gap:7px;
      border:1px solid var(--line);background:#fff;color:#405461;text-decoration:none;
      padding:9px 13px;border-radius:8px;font:inherit;font-weight:600;cursor:pointer; }}
    .button.primary {{ background:var(--teal);border-color:var(--teal);color:white; }}
    .button.danger {{ color:#b64242;background:#fff7f7;border-color:#f0dada; }}
    .button.small {{ padding:6px 9px;font-size:12px; }}
    .cards {{ display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));
      gap:14px;margin-bottom:25px; }}
    .card,.panel {{ background:#fff;border:1px solid var(--line);border-radius:12px;
      box-shadow:0 3px 12px rgba(18,51,63,.025); }}
    .card {{ padding:18px 20px; }}
    .card .number {{ font-size:28px;font-weight:700;letter-spacing:-.04em;margin-top:8px; }}
    .panel {{ padding:19px;margin-bottom:18px; }}
    .table-wrap {{ overflow:auto; }}
    table {{ width:100%;border-collapse:collapse;white-space:nowrap; }}
    th {{ text-align:left;color:#83919a;font-size:11px;text-transform:uppercase;
      letter-spacing:.07em;padding:11px 12px;border-bottom:1px solid var(--line); }}
    td {{ padding:12px;border-bottom:1px solid #eef2f3;max-width:290px;overflow:hidden;
      text-overflow:ellipsis; }}
    tr:last-child td {{ border-bottom:0; }}
    .actions {{ display:flex;align-items:center;gap:6px; }}
    .search {{ display:flex;gap:8px; }}
    input[type=search] {{ padding:9px 11px;border:1px solid var(--line);border-radius:8px;
      font:inherit;min-width:190px; }}
    .toolbar {{ display:flex;align-items:center;justify-content:space-between;gap:12px;
      margin-bottom:15px; }}
    .form-panel {{ max-width:760px; }}
    form p {{ display:grid;grid-template-columns:minmax(140px,190px) 1fr;gap:12px;
      align-items:start;margin:0;padding:13px 0;border-bottom:1px solid #eef2f3; }}
    form p:last-of-type {{ border-bottom:0; }}
    form label {{ color:#536573;font-weight:600;padding-top:8px; }}
    form input:not([type=checkbox]),form select,form textarea {{
      width:100%;padding:9px 10px;border:1px solid #dce5e8;border-radius:7px;
      background:#fff;color:var(--ink);font:inherit; }}
    form textarea {{ min-height:84px;resize:vertical; }}
    form input[type=checkbox] {{ width:18px;height:18px;margin-top:10px; }}
    .helptext {{ display:block;margin-top:4px;font-size:12px;color:var(--muted); }}
    .errorlist {{ grid-column:2;color:#b64242;font-size:13px;margin:4px 0 0;padding-left:17px; }}
    .form-errors {{ color:#b64242;background:#fff7f7;padding:12px;border-radius:8px; }}
    .form-actions {{ display:flex;gap:8px;justify-content:flex-end;margin-top:18px; }}
    .notice {{ color:#47736e;background:var(--teal-light);border-radius:8px;padding:12px 14px;
      margin-bottom:16px; }}
    .empty {{ text-align:center;color:var(--muted);padding:35px; }}
    .quick-links {{ display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:10px; }}
    .quick-links a {{ display:flex;justify-content:space-between;padding:13px;border:1px solid var(--line);
      border-radius:8px;color:var(--ink);text-decoration:none;background:#fff; }}
    .quick-links a:hover {{ border-color:#a9d8d1;color:var(--teal); }}
    .footer-note {{ margin-top:25px;font-size:12px; }}
    @media(max-width:760px) {{
      .layout {{ grid-template-columns:1fr; }}
      aside {{ border-right:0;border-bottom:1px solid var(--line);padding:12px; }}
      .brand {{ padding:0 8px 10px;margin-bottom:8px; }}
      nav {{ display:flex;overflow:auto;gap:4px; }}
      .nav-label {{ display:none; }}
      nav a {{ white-space:nowrap;padding:7px 9px; }}
      main {{ padding:22px 14px; }}
      header,.toolbar {{ align-items:stretch;flex-direction:column; }}
      form p {{ grid-template-columns:1fr;gap:4px; }}
      .errorlist {{ grid-column:1; }}
      .search {{ width:100%; }}
      input[type=search] {{ flex:1;min-width:0; }}
    }}
  </style>
</head>
<body>
  <div class="layout">
    <aside>
      <div class="brand"><div class="brand-icon">+</div><div><strong>Clinic</strong>
        <small>Management workspace</small></div></div>
      <div class="nav-label">Workspace</div>
      <nav><a class="{"active" if not active else ""}" href="/">Overview</a>{nav_links}</nav>
    </aside>
    <main>{content}</main>
  </div>
</body>
</html>"""
    return HTMLResponse(html)


def value_for(row, name: str) -> str:
    value = getattr(row, name, None)
    if callable(value):
        value = value()
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if value is None or value == "":
        return "—"
    return str(value)


def render_table(config: dict, rows, resource: str) -> str:
    columns = config["columns"]
    headings = "".join(f"<th>{escape(name.replace('_', ' ').title())}</th>" for name in columns)
    body = []
    for row in rows:
        cells = "".join(f"<td>{escape(value_for(row, name))}</td>" for name in columns)
        body.append(
            f"<tr>{cells}<td><div class='actions'>"
            f"<a class='button small' href='/records/{resource}/{row.pk}/edit'>Edit</a>"
            f"<form method='post' action='/records/{resource}/{row.pk}/delete' "
            f"onsubmit=\"return confirm('Delete this record?')\">"
            f"<button class='button small danger' type='submit'>Delete</button></form>"
            "</div></td></tr>"
        )
    if not body:
        return f"<tr><td class='empty' colspan='{len(columns) + 1}'>No records yet.</td></tr>"
    return f"<thead><tr>{headings}<th>Actions</th></tr></thead><tbody>{''.join(body)}</tbody>"


def form_page(resource: str, config: dict, form, record=None) -> HTMLResponse:
    action = "Edit" if record is not None else "Add"
    singular = config.get("singular", config["title"].rstrip("s"))
    heading = f"{action} {singular}"
    error_html = ""
    if form.errors:
        error_html = (
            '<div class="form-errors">Please correct the highlighted fields.'
            f"{form.non_field_errors().as_ul()}</div>"
        )
    form_html = form.as_p()
    content = f"""
    <header><div><div class="eyebrow">CLINIC MANAGEMENT</div><h1>{escape(heading)}</h1>
      <p>Enter the details below and save your changes.</p></div></header>
    <section class="panel form-panel">{error_html}
      <form method="post">
        {form_html}
        <div class="form-actions"><a class="button" href="/records/{resource}">Cancel</a>
          <button class="button primary" type="submit">Save record</button></div>
      </form>
    </section>
    """
    return page(heading, content, active=resource)


@app.get("/", response_class=HTMLResponse)
def dashboard(credentials: HTTPBasicCredentials | None = Depends(security)):
    user = authenticated_staff(credentials)
    if user is None:
        return RedirectResponse("/setup", status_code=303)
    today = timezone.localdate()
    upcoming = Appointment.objects.filter(appointment_date__gte=today).select_related(
        "patient", "staff"
    ).order_by("appointment_date", "appointment_time")[:6]
    cards = (
        ("Patients", Patient.objects.count(), "patients"),
        ("Active staff", Staff.objects.filter(is_active=True).count(), "staff"),
        ("Upcoming appointments", Appointment.objects.filter(
            appointment_date__gte=today, status="Scheduled"
        ).count(), "appointments"),
        ("Low stock items", InventoryItem.objects.filter(
            quantity__lte=F("reorder_level")
        ).count(), "inventory"),
    )
    card_html = "".join(
        f'<a class="card" href="/records/{link}" style="text-decoration:none;color:inherit">'
        f'<div class="eyebrow">{escape(label.upper())}</div><div class="number">{count}</div></a>'
        for label, count, link in cards
    )
    appt_config = RESOURCES["appointments"]
    upcoming_table = render_table(appt_config, upcoming, "appointments")
    quick_links = "".join(
        f'<a href="/records/{key}">{escape(label)}<span aria-hidden="true">→</span></a>'
        for key, label in NAVIGATION
    )
    content = f"""
    <header><div><div class="eyebrow">OVERVIEW</div><h1>Clinic dashboard</h1>
      <p>Here is a snapshot of your clinic today.</p></div></header>
    <section class="cards">{card_html}</section>
    <section class="panel"><div class="toolbar"><div><h2>Upcoming appointments</h2>
      <p>Scheduled visits from today onward.</p></div>
      <a class="button primary" href="/records/appointments/new">+ Add appointment</a></div>
      <div class="table-wrap"><table>{upcoming_table}</table></div></section>
    <section class="panel"><h2>Manage clinic records</h2>
      <div class="quick-links">{quick_links}</div></section>
    <p class="footer-note">Local testing app. Keep it bound to 127.0.0.1; do not expose it to the internet.</p>
    """
    return page("Overview", content)


@app.get("/records/{resource}", response_class=HTMLResponse)
def list_records(resource: str, q: str = "", user=Depends(require_staff)):
    config = get_resource(resource)
    model = config["model"]
    queryset = model.objects.all()
    if config.get("select_related"):
        queryset = queryset.select_related(*config["select_related"])
    if q.strip():
        query = Q()
        for field in config["search"]:
            query |= Q(**{f"{field}__icontains": q.strip()})
        queryset = queryset.filter(query)
    rows = queryset[:250]
    encoded_query = escape(q, quote=True)
    search_form = (
        f'<form class="search" method="get"><input type="search" name="q" value="{encoded_query}" '
        f'placeholder="Search {escape(config["title"].lower())}">'
        '<button class="button" type="submit">Search</button></form>'
    )
    content = f"""
    <header><div><div class="eyebrow">CLINIC RECORDS</div><h1>{escape(config["title"])}</h1>
      <p>View and update your clinic records.</p></div>
      <a class="button primary" href="/records/{resource}/new">+ Add record</a></header>
    <section class="panel"><div class="toolbar">{search_form}
      <span class="eyebrow">Showing up to 250 records</span></div>
      <div class="table-wrap"><table>{render_table(config, rows, resource)}</table></div></section>
    """
    return page(config["title"], content, active=resource)


@app.get("/records/{resource}/new", response_class=HTMLResponse)
def new_record(resource: str, user=Depends(require_staff)):
    config = get_resource(resource)
    form_class = modelform_factory(config["model"], fields="__all__")
    return form_page(resource, config, form_class())


@app.post("/records/{resource}/new", response_class=HTMLResponse)
async def create_record(resource: str, request: Request, user=Depends(require_staff)):
    body = (await request.body()).decode("utf-8")
    return await sync_to_async(process_create_record)(resource, body)


def process_create_record(resource: str, body: str):
    config = get_resource(resource)
    form_class = modelform_factory(config["model"], fields="__all__")
    form = form_class(data=QueryDict(body))
    if form.is_valid():
        form.save()
        return RedirectResponse(f"/records/{resource}", status_code=303)
    return form_page(resource, config, form)


@app.get("/records/{resource}/{record_id}/edit", response_class=HTMLResponse)
def edit_record(resource: str, record_id: int, user=Depends(require_staff)):
    config = get_resource(resource)
    record = get_object_or_404(config["model"], pk=record_id)
    form_class = modelform_factory(config["model"], fields="__all__")
    return form_page(resource, config, form_class(instance=record), record=record)


@app.post("/records/{resource}/{record_id}/edit", response_class=HTMLResponse)
async def update_record(resource: str, record_id: int, request: Request, user=Depends(require_staff)):
    body = (await request.body()).decode("utf-8")
    return await sync_to_async(process_update_record)(resource, record_id, body)


def process_update_record(resource: str, record_id: int, body: str):
    config = get_resource(resource)
    record = get_object_or_404(config["model"], pk=record_id)
    form_class = modelform_factory(config["model"], fields="__all__")
    form = form_class(data=QueryDict(body), instance=record)
    if form.is_valid():
        form.save()
        return RedirectResponse(f"/records/{resource}", status_code=303)
    return form_page(resource, config, form, record=record)


@app.post("/records/{resource}/{record_id}/delete")
def delete_record(resource: str, record_id: int, user=Depends(require_staff)):
    config = get_resource(resource)
    record = get_object_or_404(config["model"], pk=record_id)
    record.delete()
    return RedirectResponse(f"/records/{resource}", status_code=303)
