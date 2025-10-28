# backend/api/urls.py
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

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
    user_books_view
)

urlpatterns = [
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

    # Market (libros, my_books, etc.)
    path('api/', include('market.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
