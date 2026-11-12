from django.contrib import admin

from .models import (
    Appointment, BatchAttendance, BatchMember, Equipment, ExerciseBatch,
    InventoryItem, Patient, PhysiotherapyRecord, Staff, StaffAttendance,
)

admin.site.site_header = "Clinic Admin"
admin.site.site_title = "Clinic Admin"
admin.site.index_title = "Clinic Management (Admin Only)"


class AppointmentInline(admin.TabularInline):
    model = Appointment
    extra = 0


class PhysioInline(admin.StackedInline):
    model = PhysiotherapyRecord
    extra = 0


@admin.register(Patient)
class PatientAdmin(admin.ModelAdmin):
    list_display = ("name", "contact", "gender", "age", "diagnosis")
    search_fields = ("name", "contact", "diagnosis")
    list_filter = ("gender",)
    inlines = [AppointmentInline, PhysioInline]


@admin.register(Staff)
class StaffAdmin(admin.ModelAdmin):
    list_display = ("name", "role", "contact", "is_active")
    list_filter = ("role", "is_active")
    search_fields = ("name",)


@admin.register(Appointment)
class AppointmentAdmin(admin.ModelAdmin):
    list_display = ("appointment_date", "appointment_time", "patient", "service", "staff", "status")
    list_filter = ("service", "status", "appointment_date")
    search_fields = ("patient__name", "patient__contact", "patient__diagnosis")
    date_hierarchy = "appointment_date"
    autocomplete_fields = ("patient", "staff")


@admin.register(PhysiotherapyRecord)
class PhysiotherapyRecordAdmin(admin.ModelAdmin):
    list_display = ("patient", "diagnosis", "treated_by", "payment_type",
                    "followup_date", "total_sessions", "sessions_done", "sessions_left")
    list_filter = ("payment_type", "treated_by", "followup_date")
    search_fields = ("patient__name", "patient__contact", "diagnosis")
    autocomplete_fields = ("patient", "treated_by")


@admin.register(ExerciseBatch)
class ExerciseBatchAdmin(admin.ModelAdmin):
    list_display = ("batch_name", "start_time", "end_time", "trainer")


@admin.register(BatchMember)
class BatchMemberAdmin(admin.ModelAdmin):
    list_display = ("patient", "batch", "joined_on", "is_active")
    list_filter = ("batch", "is_active")
    search_fields = ("patient__name",)
    autocomplete_fields = ("patient",)


@admin.register(BatchAttendance)
class BatchAttendanceAdmin(admin.ModelAdmin):
    list_display = ("att_date", "batch", "patient", "present")
    list_filter = ("batch", "present", "att_date")
    search_fields = ("patient__name",)
    date_hierarchy = "att_date"
    autocomplete_fields = ("patient",)


@admin.register(StaffAttendance)
class StaffAttendanceAdmin(admin.ModelAdmin):
    list_display = ("att_date", "staff", "status", "time_in", "time_out")
    list_filter = ("status", "staff__role", "att_date")
    search_fields = ("staff__name",)
    date_hierarchy = "att_date"
    autocomplete_fields = ("staff",)


@admin.register(InventoryItem)
class InventoryItemAdmin(admin.ModelAdmin):
    list_display = ("item_name", "category", "quantity", "unit", "reorder_level", "low_stock")
    list_filter = ("category",)
    search_fields = ("item_name",)

    @admin.display(boolean=True, description="Low stock")
    def low_stock(self, obj):
        return obj.is_low


@admin.register(Equipment)
class EquipmentAdmin(admin.ModelAdmin):
    list_display = ("equipment_name", "department", "qty_present", "qty_required", "qty_to_buy", "condition")
    list_filter = ("department", "condition")
    search_fields = ("equipment_name",)
