# core/serializers.py
from django.contrib.auth.hashers import check_password, make_password
from .models import Usuario, PasswordResetToken
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers
from django.db.models import F
from django.conf import settings
from .models import Usuario, Region, Comuna, PasswordResetToken


class UsuarioLiteSerializer(serializers.ModelSerializer):
    es_admin = serializers.SerializerMethodField()  # 👈 NUEVO

    class Meta:
        model = Usuario
        fields = (
            "id_usuario", "nombre_usuario", "email",
            "nombres", "apellido_paterno", "imagen_perfil",
            "activo", "verificado",
            "es_admin",   # 👈 IMPORTANTE: sin espacio, este es el campo que verá el front
        )

    def get_es_admin(self, obj):
        """
        Marca como admin si el email del usuario está en CAMBIOTECA_ADMIN_EMAILS.
        """
        admin_emails = getattr(settings, "CAMBIOTECA_ADMIN_EMAILS", [])
        email = (obj.email or "").lower()
        return any(email == a.lower() for a in admin_emails)



class UsuarioSummarySerializer(serializers.ModelSerializer):
    es_admin = serializers.SerializerMethodField()

    class Meta:
        model = Usuario
        fields = (
            "id_usuario", "rut", "nombre_usuario", "email",
            "nombres", "apellido_paterno", "apellido_materno",
            "imagen_perfil", "activo", "verificado",
            "es_admin",   # 👈 AHORA sí va en fields
        )

    def get_es_admin(self, obj):
        """
        Devuelve True si el usuario es admin.
        Usa el campo booleano es_admin de tu modelo
        y, opcionalmente, la lista de correos admin.
        """
        # 1) Campo booleano de la tabla usuario
        if hasattr(obj, "es_admin"):
            return bool(obj.es_admin)

        # 2) (Opcional) respaldo por correo configurado en settings
        from django.conf import settings
        admin_emails = getattr(settings, "CAMBIOTECA_ADMIN_EMAILS", [])
        email = (obj.email or "").lower()
        return any(email == a.lower() for a in admin_emails)


class LoginSerializer(serializers.Serializer):
    login = serializers.CharField()                      # email o nombre_usuario
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    device = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        login = attrs.get("login")
        password = attrs.get("password")

        user = Usuario.objects.filter(
            Q(email__iexact=login) | Q(nombre_usuario__iexact=login)
        ).first()
        if not user:
            raise serializers.ValidationError("Usuario no encontrado.")

        ok = False
        try:
            ok = check_password(password, user.contrasena)  # por si está hasheada
        except Exception:
            ok = False
        if not ok and user.contrasena == password:          # o en texto plano
            ok = True

        if not ok:
            raise serializers.ValidationError("Credenciales inválidas.")

        if not user.activo:
            raise serializers.ValidationError("Usuario inactivo. Contacta soporte.")

        attrs["user"] = user
        return attrs


class RegisterSerializer(serializers.ModelSerializer):
    # NOTA: NO usamos ImageField aquí. El modelo tiene CharField para 'imagen_perfil',
    # y la vista ya guarda el archivo y pasa la ruta como string.
    imagen_perfil = serializers.CharField(
        required=False, allow_blank=True, allow_null=True
    )

    class Meta:
        model = Usuario
        fields = (
            "rut", "nombres", "apellido_paterno", "apellido_materno",
            "nombre_usuario", "email", "telefono",
            "direccion", "numeracion", "comuna",
            "contrasena", "imagen_perfil"
        )
        extra_kwargs = {
            "contrasena": {"write_only": True},
        }

    def validate_email(self, value):
        if Usuario.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Email ya registrado.")
        return value

    def validate_rut(self, value):
        if Usuario.objects.filter(rut=value).exists():
            raise serializers.ValidationError("RUT ya registrado.")
        return value

    def create(self, validated_data):
        validated_data["contrasena"] = make_password(validated_data["contrasena"])
        return Usuario.objects.create(
            **validated_data,
            fecha_registro=timezone.now().date(),
            calificacion=0,
            numero_intercambios=0,
            activo=True,
            verificado=False,
        )


class RegionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Region
        fields = ("id_region", "nombre")


class ComunaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Comuna
        fields = ("id_comuna", "nombre", "id_region")

class ForgotPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def validate(self, attrs):
        email = attrs.get('email')
        user = Usuario.objects.filter(email__iexact=email, activo=True).first()
        attrs['user'] = user  # puede ser None; no revelaremos si existe
        return attrs


class ResetPasswordSerializer(serializers.Serializer):
    token = serializers.CharField()
    password = serializers.CharField(write_only=True)
    password2 = serializers.CharField(write_only=True)

    def validate(self, attrs):
        t = attrs.get('token')
        p1 = attrs.get('password')
        p2 = attrs.get('password2')

        if p1 != p2:
            raise serializers.ValidationError({"password2": ["Las contraseñas no coinciden."]})

        prt = PasswordResetToken.objects.filter(token=t, used=False).select_related('user').first()
        if not prt or prt.is_expired:
            raise serializers.ValidationError({"token": ["Token inválido o expirado."]})

        attrs['prt'] = prt
        return attrs

    def save(self, **kwargs):
        prt: PasswordResetToken = self.validated_data['prt']
        user: Usuario = prt.user

        user.contrasena = make_password(self.validated_data['password'])
        user.save(update_fields=['contrasena'])

        prt.used = True
        prt.save(update_fields=['used'])
        return user
