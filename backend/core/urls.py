# core/urls.py (o donde agrupes tus endpoints)
from django.urls import path
from .views_auth import login_issue_tokens, logout_all_devices

urlpatterns = [
    path("auth/login/", login_issue_tokens, name="login"),
    path("auth/logout-all/", logout_all_devices, name="logout_all"),
    
]
