from django.contrib import admin
from django.urls import path
from django.views.generic import RedirectView

# The ONLY thing in this system is the admin panel (login required).
urlpatterns = [
    path("", RedirectView.as_view(url="/admin/", permanent=False)),
    path("admin/", admin.site.urls),
]
