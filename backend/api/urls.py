# backend/api/urls.py
from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.conf.urls.static import static
from django.http import JsonResponse, HttpResponse
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
)

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

    # Auth
    path('api/auth/login/', login_view),
    path('api/auth/register/', register_usuario),
    path('api/auth/forgot/', forgot_password),
    path('api/auth/reset/', reset_password),
    path('api/auth/change-password/', change_password_view),

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

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
else:
    urlpatterns += [
        re_path(r'^media/(?P<path>.*)$', media_serve, {'document_root': settings.MEDIA_ROOT}),
    ]