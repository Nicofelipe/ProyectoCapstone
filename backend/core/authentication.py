# core/authentication.py
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework.exceptions import AuthenticationFailed
from core.models import Usuario

class UsuarioJWTAuthentication(JWTAuthentication):
    def get_user(self, validated_token):
        uid = validated_token.get("user_id", None)
        if uid is None:
            raise AuthenticationFailed("Token sin user_id.", code="no_user_id")

        try:
            user = Usuario.objects.get(pk=uid)
        except Usuario.DoesNotExist:
            raise AuthenticationFailed("Usuario no existe.", code="user_not_found")

        # Validar versión
        tv_claim = validated_token.get("tv", None)
        if tv_claim is None or int(tv_claim) != int(getattr(user, "token_version", 0)):
            raise AuthenticationFailed("Token invalidado (logout global).", code="token_invalidated")

        return user