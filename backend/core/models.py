# core/models.py

from django.db import models
from django.utils import timezone
from datetime import timedelta


class PasswordResetToken(models.Model):
    user = models.ForeignKey('core.Usuario', on_delete=models.CASCADE, related_name='reset_tokens')
    token = models.CharField(max_length=128, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    used = models.BooleanField(default=False)

    class Meta:
        db_table = 'password_reset_token'  # coincide con la tabla creada

    @property
    def is_expired(self) -> bool:
        # vence en 24h (ajusta si quieres)
        return self.created_at < timezone.now() - timedelta(hours=24)

    def __str__(self):
        return f"{self.user_id} - {self.token[:8]}..."


class Region(models.Model):
    id_region = models.AutoField(primary_key=True)
    nombre = models.CharField(max_length=100)

    class Meta:
        db_table = 'region'
        managed = False

    def __str__(self):
        return self.nombre


class Comuna(models.Model):
    id_comuna = models.AutoField(primary_key=True)
    nombre = models.CharField(max_length=100)
    id_region = models.ForeignKey(
        Region,
        db_column='id_region',
        on_delete=models.DO_NOTHING,
        related_name='comunas'
    )

    class Meta:
        db_table = 'comuna'
        managed = False

    def __str__(self):
        return f"{self.nombre} ({self.id_region.nombre})"

class Usuario(models.Model):
    id_usuario = models.AutoField(primary_key=True)
    rut = models.CharField(unique=True, max_length=12)
    nombres = models.CharField(max_length=150)
    apellido_paterno = models.CharField(max_length=100)
    apellido_materno = models.CharField(max_length=100)
    nombre_usuario = models.CharField(max_length=50)
    email = models.EmailField(unique=True, max_length=100)
    telefono = models.CharField(max_length=15)
    direccion = models.CharField(max_length=255)
    numeracion = models.CharField(max_length=10)
    es_admin = models.BooleanField(default=False)  
    token_version = models.PositiveIntegerField(default=0) 

    # En la tabla el campo es comuna_id, mantenemos ese nombre con db_column
    comuna = models.ForeignKey(
        Comuna,
        db_column='comuna_id',
        on_delete=models.DO_NOTHING,
        related_name='usuarios'
    )

    contrasena = models.CharField(max_length=255)
    fecha_registro = models.DateField()
    calificacion = models.DecimalField(max_digits=3, decimal_places=1, default=0)
    numero_intercambios = models.IntegerField(default=0)

    # Si luego querés ImageField, instala Pillow y cambialo
    imagen_perfil = models.CharField(max_length=255, null=True, blank=True)

    activo = models.BooleanField(default=False)
    verificado = models.BooleanField(default=False)

     # ✅ agrega estas dos properties
    @property
    def is_authenticated(self) -> bool:
        return True

    @property
    def is_anonymous(self) -> bool:
        return False

    class Meta:
        db_table = 'usuario'
        managed = False

    def __str__(self):
        return f"{self.nombres} {self.apellido_paterno} (@{self.nombre_usuario})"


class Notificacion(models.Model):
    id_notificacion = models.AutoField(primary_key=True)
    mensaje = models.TextField()
    leido = models.BooleanField(default=False)
    # En el dump puede venir NULL
    fecha_envio = models.DateTimeField(null=True, blank=True)

    id_usuario = models.ForeignKey(
        'core.Usuario',
        db_column='id_usuario',
        on_delete=models.DO_NOTHING,
        related_name='notificaciones'
    )

    class Meta:
        db_table = 'notificacion'
        managed = False

    def __str__(self):
        return f"Notif #{self.id_notificacion} -> Usuario {self.id_usuario_id}"


class SeguimientoActividad(models.Model):
    id_actividad = models.AutoField(primary_key=True)
    accion = models.CharField(max_length=255)
    fecha_hora = models.DateTimeField()
    ip_origen = models.CharField(max_length=45)
    dispositivo = models.CharField(max_length=50)
    ubicacion = models.CharField(max_length=255, null=True, blank=True)

    id_usuario = models.ForeignKey(
        'core.Usuario',
        db_column='id_usuario',
        on_delete=models.DO_NOTHING,
        related_name='actividades'
    )

    class Meta:
        db_table = 'seguimiento_actividad'
        managed = False

    def __str__(self):
        return f"Actividad #{self.id_actividad} ({self.accion})"


class Sesion(models.Model):
    id_sesion = models.AutoField(primary_key=True)
    token = models.CharField(max_length=255)
    fecha_inicio = models.DateTimeField()
    fecha_expiracion = models.DateTimeField()
    dispositivo = models.CharField(max_length=50)

    id_usuario = models.ForeignKey(
        'core.Usuario',
        db_column='id_usuario',
        on_delete=models.DO_NOTHING,
        related_name='sesiones'
    )

    class Meta:
        db_table = 'sesion'
        managed = False

    def __str__(self):
        return f"Sesión #{self.id_sesion} de Usuario {self.id_usuario_id}"


class VerificacionUsuario(models.Model):
    id_verificacion = models.AutoField(primary_key=True)
    documento_identidad = models.CharField(unique=True, max_length=255)
    fecha_verificacion = models.DateField()
    verificado_por = models.CharField(max_length=50)

    id_usuario = models.ForeignKey(
        'core.Usuario',
        db_column='id_usuario',
        on_delete=models.DO_NOTHING,
        related_name='verificaciones'
    )

    class Meta:
        db_table = 'verificacion_usuario'
        managed = False

    def __str__(self):
        return f"Verificación #{self.id_verificacion} de Usuario {self.id_usuario_id}"