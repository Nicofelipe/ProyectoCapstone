# backend/api/urls.py
from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.views.static import serve as dj_serve
from django.http import JsonResponse, HttpResponse

# Vistas de CORE (públicas/usuario/admin)
from core.views import (
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
    # ADMIN
    admin_dashboard_summary,
    admin_get_all_users,
    admin_delete_user,
    admin_toggle_user_active,
)

# Auth JWT (login / logout-all) ya estandarizado en views_auth
from core import views_auth as auth


# --------- endpoints simples ----------
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
# --------------------------------------


urlpatterns = [
    # raíz y health
    path("", index),
    path("health/", health),

    # Django admin
    path("admin/", admin.site.urls),

    # ------- AUTH (JWT con token_version) -------
    # Nota: también están en core/urls; si prefieres evitar duplicado,
    # puedes comentar estas dos y depender solo de include("core.urls").
    path("api/auth/login/", auth.login_issue_tokens, name="auth-login"),
    path("api/auth/logout-all/", auth.logout_all_devices, name="auth-logout-all"),

    # ------- CORE (registro, catálogo, perfil, password reset, etc.) -------
    path("api/auth/register/", register_usuario, name="auth-register"),
    path("api/auth/forgot/", forgot_password, name="auth-forgot"),
    path("api/auth/reset/", reset_password, name="auth-reset"),
    path("api/auth/change-password/", change_password_view, name="auth-change-password"),

    path("api/catalog/regiones/", regiones_view, name="catalog-regiones"),
    path("api/catalog/comunas/", comunas_view, name="catalog-comunas"),

    path("api/users/<int:user_id>/profile/", user_profile_view, name="user-profile"),
    path("api/users/<int:user_id>/intercambios/", user_intercambios_view, name="user-intercambios"),
    path("api/users/<int:id>/summary/", user_summary, name="user-summary"),
    path("api/users/<int:id>/", update_user_profile, name="user-update"),
    path("api/users/<int:id>/avatar/", update_user_avatar, name="user-avatar"),
    path("api/users/<int:user_id>/books/", user_books_view, name="user-books"),

    # ------- ADMIN (requieren permiso IsAdminUser) -------
    path("api/admin/summary/", admin_dashboard_summary, name="admin-summary"),
    path("api/admin/users/", admin_get_all_users, name="admin-users-list"),
    path("api/admin/users/<int:user_id>/toggle/", admin_toggle_user_active, name="admin-user-toggle"),
    path("api/admin/users/<int:user_id>/delete/", admin_delete_user, name="admin-user-delete"),

    # ------- APPS -------
    # core.urls (contiene también auth/login y logout-all; puedes dejarlo activo
    # o desactivar las rutas explícitas de arriba para no duplicar)
    path("api/", include("core.urls")),
    # market (libros, imágenes, solicitudes, intercambios, chat, favoritos, puntos de encuentro)
    path("api/", include("market.urls")),
]

# Media (Railway / producción sin Nginx)
urlpatterns += [
    re_path(r"^media/(?P<path>.*)$", dj_serve, {"document_root": settings.MEDIA_ROOT}),
]
