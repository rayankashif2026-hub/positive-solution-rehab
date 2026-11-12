from django.db import models


class Patient(models.Model):
    GENDER = [("Female", "Female"), ("Male", "Male"), ("Other", "Other")]

    name = models.CharField(max_length=150)
    contact = models.CharField(max_length=30, blank=True)
    gender = models.CharField(max_length=10, choices=GENDER, blank=True)
    age = models.PositiveIntegerField(null=True, blank=True)
    diagnosis = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.contact})" if self.contact else self.name


class Staff(models.Model):
    ROLES = [
        ("Doctor", "Doctor"),
        ("Intern", "Intern"),
        ("Physiotherapist", "Physiotherapist"),
        ("Psychologist", "Psychologist"),
        ("Nutritionist", "Nutritionist"),
        ("Hijama Therapist", "Hijama Therapist"),
        ("Trainer", "Trainer"),
    ]

    name = models.CharField(max_length=150)
    role = models.CharField(max_length=30, choices=ROLES)
    contact = models.CharField(max_length=30, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "Staff"

    def __str__(self):
        return f"{self.name} - {self.role}"


class Appointment(models.Model):
    SERVICES = [
        ("Physiotherapy", "Physiotherapy"),
        ("Psychology", "Psychology"),
        ("Hijama", "Hijama"),
        ("Nutrition", "Nutrition"),
    ]
    STATUS = [
        ("Scheduled", "Scheduled"),
        ("Completed", "Completed"),
        ("Cancelled", "Cancelled"),
        ("No-show", "No-show"),
    ]

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="appointments")
    service = models.CharField(max_length=20, choices=SERVICES)
    appointment_date = models.DateField()
    appointment_time = models.TimeField()
    staff = models.ForeignKey(Staff, on_delete=models.SET_NULL, null=True, blank=True)
    status = models.CharField(max_length=15, choices=STATUS, default="Scheduled")
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-appointment_date", "appointment_time"]

    def __str__(self):
        return f"{self.patient.name} - {self.service} - {self.appointment_date} {self.appointment_time:%H:%M}"


class PhysiotherapyRecord(models.Model):
    PAYMENT = [("Paid", "Paid"), ("Unpaid", "Unpaid"), ("Needy", "Needy")]

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="physio_records")
    diagnosis = models.TextField()
    treated_by = models.ForeignKey(Staff, on_delete=models.SET_NULL, null=True, blank=True)
    payment_type = models.CharField(max_length=10, choices=PAYMENT)
    followup_date = models.DateField(null=True, blank=True)
    total_sessions = models.PositiveIntegerField(default=0, help_text="Sessions planned")
    sessions_done = models.PositiveIntegerField(default=0)
    start_date = models.DateField(auto_now_add=True)

    class Meta:
        ordering = ["-start_date"]

    @property
    def sessions_left(self):
        return max(self.total_sessions - self.sessions_done, 0)

    def __str__(self):
        return f"{self.patient.name} - {self.diagnosis[:30]}"


class ExerciseBatch(models.Model):
    BATCHES = [("Morning", "Morning"), ("Evening", "Evening")]

    batch_name = models.CharField(max_length=10, choices=BATCHES)
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    trainer = models.ForeignKey(Staff, on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        verbose_name_plural = "Exercise batches (female)"

    def __str__(self):
        return f"{self.batch_name} batch"


class BatchMember(models.Model):
    batch = models.ForeignKey(ExerciseBatch, on_delete=models.CASCADE, related_name="members")
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE)
    joined_on = models.DateField(auto_now_add=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = ("batch", "patient")

    def __str__(self):
        return f"{self.patient.name} in {self.batch}"


class BatchAttendance(models.Model):
    batch = models.ForeignKey(ExerciseBatch, on_delete=models.CASCADE)
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE)
    att_date = models.DateField()
    present = models.BooleanField(default=True)

    class Meta:
        unique_together = ("batch", "patient", "att_date")
        ordering = ["-att_date"]
        verbose_name_plural = "Batch attendance"

    def __str__(self):
        return f"{self.patient.name} {self.att_date} {'P' if self.present else 'A'}"


class StaffAttendance(models.Model):
    STATUS = [("Present", "Present"), ("Absent", "Absent"), ("Leave", "Leave"), ("Late", "Late")]

    staff = models.ForeignKey(Staff, on_delete=models.CASCADE)
    att_date = models.DateField()
    status = models.CharField(max_length=10, choices=STATUS, default="Present")
    time_in = models.TimeField(null=True, blank=True)
    time_out = models.TimeField(null=True, blank=True)

    class Meta:
        unique_together = ("staff", "att_date")
        ordering = ["-att_date"]
        verbose_name_plural = "Doctors & interns attendance"

    def __str__(self):
        return f"{self.staff.name} {self.att_date} {self.status}"


class InventoryItem(models.Model):
    item_name = models.CharField(max_length=150)
    category = models.CharField(max_length=80, blank=True)
    quantity = models.PositiveIntegerField(default=0)
    unit = models.CharField(max_length=30, blank=True, help_text="e.g. pcs, bottles, boxes")
    reorder_level = models.PositiveIntegerField(default=0)
    last_updated = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["item_name"]

    @property
    def is_low(self):
        return self.quantity <= self.reorder_level

    def __str__(self):
        return self.item_name


class Equipment(models.Model):
    DEPARTMENTS = [
        ("Physiotherapy", "Physiotherapy"),
        ("Psychology", "Psychology"),
        ("Hijama", "Hijama"),
        ("Nutrition", "Nutrition"),
        ("Exercise", "Exercise"),
        ("General", "General"),
    ]

    equipment_name = models.CharField(max_length=150)
    department = models.CharField(max_length=20, choices=DEPARTMENTS, default="General")
    qty_present = models.PositiveIntegerField(default=0)
    qty_required = models.PositiveIntegerField(default=0)
    condition = models.CharField(max_length=50, default="Good")

    class Meta:
        ordering = ["department", "equipment_name"]
        verbose_name_plural = "Equipment"

    @property
    def qty_to_buy(self):
        return max(self.qty_required - self.qty_present, 0)

    def __str__(self):
        return self.equipment_name
