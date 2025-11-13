
# backend/api/urls.py
from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.conf.urls.static import static
from django.views.static import serve as dj_serve
from django.urls import re_path
from django.http import JsonResponse, HttpResponse
from core import views as core
from core import views_auth as auth
from django.views.static import serve as media_serve
from core.views import (
    login_view,
    register_usuario,
    regiones_view,
    comunas_view,
    forgot_password,
    reset_password,
    user_profile_view,
    user_intercambios_view,
    change_password_view,
    user_summary,
    update_user_profile,
    update_user_avatar,
    user_books_view,
    change_password_view
    
)
from core import views as core_views
from core import views_auth as auth_views 
# --------- nuevas vistas simples ----------
def index(_request):
    return JsonResponse({
        "name": "Cambioteca API",
        "status": "ok",
        "docs": None,
        "useful_endpoints": [
            "/api/libros/latest/",
            "/api/libros/populares/",
            "/admin/",
        ],
    })

def health(_request):
    return HttpResponse("OK", content_type="text/plain")
# ------------------------------------------

urlpatterns = [
    # raíz y health
    path("", index),
    path("health/", health),

    # admin
    path('admin/', admin.site.urls),
    path("api/", include("core.urls")),

    # Auth
    path("api/auth/login/", auth.login_issue_tokens),
    path("api/auth/logout-all/", auth.logout_all_devices),
    path('api/auth/register/', register_usuario),
    path('api/auth/forgot/', forgot_password),
    path('api/auth/reset/', reset_password),
    path('api/auth/change-password/', change_password_view),
    path("api/auth/change-password/", change_password_view, name="change_password"),

    # Catálogo / Usuarios
    path('api/catalog/regiones/', regiones_view),
    path('api/catalog/comunas/', comunas_view),
    path('api/users/<int:user_id>/profile/', user_profile_view),
    path('api/users/<int:user_id>/intercambios/', user_intercambios_view),
    path('api/users/<int:id>/summary/', user_summary),
    path('api/users/<int:id>/', update_user_profile),
    path('api/users/<int:id>/avatar/', update_user_avatar),
    path('api/users/<int:user_id>/books/', user_books_view),

    # Market (libros, chats, intercambios, etc.)
    path('api/', include('market.urls')),
]

urlpatterns += [
    re_path(r'^media/(?P<path>.*)$', dj_serve, {'document_root': settings.MEDIA_ROOT}),
]
