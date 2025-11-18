
# core/urls.py (o donde agrupes tus endpoints)
from django.urls import path
from .views_auth import login_issue_tokens, logout_all_devices
from .views_public import PublicConfigView
from core import views as core_views

urlpatterns = [
    path("auth/login/", login_issue_tokens, name="login"),
    path("auth/logout-all/", logout_all_devices, name="logout_all"),
    path("public/config/", PublicConfigView.as_view(), name="public-config"),
    path('admin/dashboard-summary/', core_views.admin_dashboard_summary),
    
    
]
