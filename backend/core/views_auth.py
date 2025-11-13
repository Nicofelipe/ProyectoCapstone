# core/views_auth.py
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from rest_framework_simplejwt.tokens import RefreshToken
from django.db import transaction
from django.db.models import F

from django.conf import settings
from django.utils import timezone
import os

from .serializers import LoginSerializer
from core.models import Usuario

# --- helper igual al de core.views ---
def _abs_media_url(request, rel_path: str) -> str:
    if not rel_path:
        rel_path = ''
    if str(rel_path).startswith(('http://', 'https://')):
        return str(rel_path)
    media_prefix = settings.MEDIA_URL.lstrip('/')
    path_clean = str(rel_path).lstrip('/')
    if path_clean.startswith(media_prefix):
        url_path = '/' + path_clean
    else:
        url_path = '/' + media_prefix + path_clean
    return request.build_absolute_uri(url_path)

@api_view(["POST"])
@permission_classes([AllowAny])
def login_issue_tokens(request):
    # 👇 Permite {email, contrasena} o {login, password}
    login_value = request.data.get("login") or request.data.get("email") or ""
    password_value = request.data.get("password") or request.data.get("contrasena") or ""

    ser = LoginSerializer(data={"login": login_value, "password": password_value})
    ser.is_valid(raise_exception=True)
    user: Usuario = ser.validated_data["user"]

    # SimpleJWT tokens con claim de versión
    refresh = RefreshToken.for_user(user)
    refresh["tv"] = getattr(user, "token_version", 0)
    access = refresh.access_token
    access["tv"] = getattr(user, "token_version", 0)

    # payload de usuario consistente con tu front (id, avatar_url, etc.)
    default_rel = "avatars/avatardefecto.jpg"
    rel = (user.imagen_perfil or "").strip() or default_rel
    avatar_url = _abs_media_url(request, rel)

    user_payload = {
        "id": user.id_usuario,
        "email": user.email,
        "nombres": user.nombres,
        "apellido_paterno": user.apellido_paterno,
        "apellido_materno": user.apellido_materno,
        "nombre_usuario": user.nombre_usuario,
        "imagen_perfil": user.imagen_perfil,
        "avatar_url": avatar_url,
        "verificado": bool(user.verificado),
        "es_admin": bool(getattr(user, "es_admin", False)),
    }

    return Response({
        "refresh": str(refresh),
        "access": str(access),
        "user": user_payload
    }, status=status.HTTP_200_OK)

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout_all_devices(request):
    user = request.user
    with transaction.atomic():
        type(user).objects.filter(pk=user.pk).update(token_version=F("token_version") + 1)
    return Response({"detail": "Sesiones cerradas en todos los dispositivos."})