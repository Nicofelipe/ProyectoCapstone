#market models.py

from django.db import models
from rest_framework import serializers
from .constants import SOLICITUD_ESTADO, INTERCAMBIO_ESTADO
from django.utils import timezone

class Genero(models.Model):
    id_genero = models.AutoField(primary_key=True)
    nombre = models.CharField(max_length=100)

    class Meta:
        db_table = 'genero'
        managed = False  # si la tabla ya existe en tu BD; pon True si la migrará Django

    def __str__(self):
        return self.nombre

# Referencias entre apps por string:
# 'core.Usuario', 'market.Libro'

class Libro(models.Model):
    id_libro = models.AutoField(primary_key=True)
    titulo = models.CharField(max_length=255)
    isbn = models.CharField(max_length=13)
    anio_publicacion = models.PositiveSmallIntegerField()  # YEAR en MySQL -> int corto
    autor = models.CharField(max_length=255)
    estado = models.CharField(max_length=20)               # Enum en BD; aquí como CharField
    descripcion = models.TextField()
    editorial = models.CharField(max_length=255)
    tipo_tapa = models.CharField(max_length=20)            # Enum en BD; aquí CharField
    disponible = models.BooleanField(default=True)
    fecha_subida = models.DateTimeField(db_column='fecha_subida', auto_now_add=False)

    id_usuario = models.ForeignKey(
        'core.Usuario', db_column='id_usuario',
        on_delete=models.DO_NOTHING, related_name='libros'
    )
    id_genero = models.ForeignKey(
        'market.Genero', db_column='id_genero',
        on_delete=models.RESTRICT, related_name='libros'
    )

    class Meta:
        db_table = 'libro'
        managed = False

    def __str__(self):
        return f"{self.titulo} — {self.autor}"


class Calificacion(models.Model):
    id_clasificacion = models.AutoField(primary_key=True)
    puntuacion = models.IntegerField()
    comentario = models.TextField()

    id_usuario_calificador = models.ForeignKey(
        'core.Usuario', db_column='id_usuario_calificador',
        on_delete=models.DO_NOTHING, related_name='clasificaciones_hechas'
    )
    id_usuario_calificado = models.ForeignKey(
        'core.Usuario', db_column='id_usuario_calificado',
        on_delete=models.DO_NOTHING, related_name='clasificaciones_recibidas'
    )
    id_intercambio = models.ForeignKey(
        'market.Intercambio', db_column='id_intercambio',
        on_delete=models.SET_NULL, null=True, blank=True, related_name='calificaciones'
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["id_intercambio", "id_usuario_calificador"],
                name="uniq_calificacion_user_intercambio",
            )
        ]

    class Meta:
        db_table = 'calificacion'
        managed = False

    def __str__(self):
        return f"Calificación {self.puntuacion} a {self.id_usuario_calificado_id}"

Clasificacion = Calificacion  # alias compat


class Favorito(models.Model):
    id_favorito = models.AutoField(primary_key=True)

    # Accesos:
    # - usuario.favoritos.all()
    # - libro.marcado_como_favorito_por.all()
    id_usuario = models.ForeignKey(
        'core.Usuario',
        db_column='id_usuario',
        on_delete=models.DO_NOTHING,
        related_name='favoritos'
    )
    id_libro = models.ForeignKey(
        'market.Libro',
        db_column='id_libro',
        on_delete=models.DO_NOTHING,
        related_name='marcado_como_favorito_por'
    )

    class Meta:
        db_table = 'favorito'
        managed = False

    def __str__(self):
        return f"Fav #{self.id_favorito} — Usuario {self.id_usuario_id} / Libro {self.id_libro_id}"


class ImagenLibro(models.Model):
    id_imagen = models.AutoField(primary_key=True)
    # Dejá CharField si no querés depender de Pillow.
    url_imagen = models.CharField(max_length=255, null=True, blank=True)
    descripcion = models.CharField(max_length=255, null=True, blank=True)

    # Acceso: libro.imagenes.all()
    id_libro = models.ForeignKey(
        'market.Libro',
        db_column='id_libro',
        on_delete=models.DO_NOTHING,
        related_name='imagenes'
    )

    # IMPORTANTE: refleja que la columna en BD no acepta NULL
    orden = models.PositiveIntegerField(default=0, db_column='orden')
    is_portada = models.BooleanField(default=False, db_column='is_portada')
    created_at = models.DateTimeField(auto_now_add=True, db_column='created_at')

    class Meta:
        db_table = 'imagen_libro'
        managed = False

    def __str__(self):
        return f"Imagen #{self.id_imagen} de Libro {self.id_libro_id}"





class Mensaje(models.Model):
    id_mensaje = models.AutoField(primary_key=True)
    mensaje = models.TextField()
    fecha_envio = models.DateTimeField()
    id_intercambio = models.ForeignKey(
        'market.Intercambio', db_column='id_intercambio',
        on_delete=models.DO_NOTHING, related_name='mensajes'
    )
    id_usuario_emisor = models.ForeignKey(
        'core.Usuario', db_column='id_usuario_emisor',
        on_delete=models.DO_NOTHING, related_name='mensajes_enviados'
    )
    id_usuario_receptor = models.ForeignKey(
        'core.Usuario', db_column='id_usuario_receptor',
        on_delete=models.DO_NOTHING, related_name='mensajes_recibidos'
    )

    class Meta:
        db_table = 'mensaje'
        managed = False



class LibroSolicitudesVistas(models.Model):
    id = models.AutoField(primary_key=True)
    id_usuario = models.ForeignKey(
        'core.Usuario', db_column='id_usuario',
        on_delete=models.CASCADE, related_name='libros_solicitudes_vistas'
    )
    id_libro = models.ForeignKey(
        'market.Libro', db_column='id_libro',
        on_delete=models.CASCADE, related_name='solicitudes_vistas_por'
    )
    ultimo_visto_id_intercambio = models.IntegerField(default=0)
    visto_por_ultima_vez = models.DateTimeField()

    class Meta:
        db_table = 'libro_solicitudes_vistas'
        managed = False
        unique_together = (('id_usuario', 'id_libro'),)


class Conversacion(models.Model):
    id_conversacion = models.AutoField(primary_key=True)
    id_intercambio = models.ForeignKey(
        'market.Intercambio', db_column='id_intercambio',
        on_delete=models.DO_NOTHING, related_name='conversaciones'
    )
    creado_en = models.DateTimeField(default=timezone.now)
    actualizado_en = models.DateTimeField(default=timezone.now)
    ultimo_id_mensaje = models.IntegerField(default=0, db_column='ultimo_id_mensaje')  # <-- default 0 y sin null=True

    class Meta:
        db_table = 'conversacion'
        managed = False


class ConversacionParticipante(models.Model):
    # SIN 'id' aquí
    id_conversacion = models.ForeignKey(
        'market.Conversacion', db_column='id_conversacion',
        on_delete=models.CASCADE, related_name='participantes',
        primary_key=True  # <-- evita que Django agregue un id auto
    )
    id_usuario = models.ForeignKey(
        'core.Usuario', db_column='id_usuario',
        on_delete=models.CASCADE, related_name='conversaciones'
    )
    rol = models.CharField(max_length=20, null=True, blank=True)
    silenciado = models.BooleanField(default=False)
    archivado = models.BooleanField(default=False)
    ultimo_visto_id_mensaje = models.IntegerField(default=0, db_column='ultimo_visto_id_mensaje')
    visto_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'conversacion_participante'
        managed = False
        unique_together = (('id_conversacion','id_usuario'),)


class ConversacionMensaje(models.Model):
    id_mensaje = models.AutoField(primary_key=True, db_column='id_mensaje')
    id_conversacion = models.ForeignKey(
        'market.Conversacion', db_column='id_conversacion',
        on_delete=models.CASCADE, related_name='mensajes'
    )
    id_usuario_emisor = models.ForeignKey(
        'core.Usuario', db_column='id_usuario_emisor',
        on_delete=models.DO_NOTHING, related_name='mensajes_chat_enviados'
    )
    cuerpo = models.TextField(db_column='cuerpo')
    enviado_en = models.DateTimeField(db_column='enviado_en')
    editado_en = models.DateTimeField(db_column='editado_en', null=True, blank=True)
    eliminado = models.BooleanField(default=False)

    class Meta:
        db_table = 'conversacion_mensaje'
        managed = False


class SolicitudIntercambio(models.Model):
    id_solicitud = models.AutoField(primary_key=True)
    id_usuario_solicitante = models.ForeignKey('core.Usuario', db_column='id_usuario_solicitante',
                                               on_delete=models.DO_NOTHING, related_name='solicitudes_hechas')
    id_usuario_receptor = models.ForeignKey('core.Usuario', db_column='id_usuario_receptor',
                                            on_delete=models.DO_NOTHING, related_name='solicitudes_recibidas')
    id_libro_deseado = models.ForeignKey('market.Libro', db_column='id_libro_deseado',
                                         on_delete=models.DO_NOTHING, related_name='solicitudes_para_este_libro')
    id_libro_ofrecido_aceptado = models.ForeignKey('market.Libro', db_column='id_libro_ofrecido_aceptado_id',
                                                   on_delete=models.SET_NULL, null=True, blank=True,
                                                   related_name='solicitudes_donde_fue_aceptado')

    estado = models.CharField(
        max_length=10,
        default=SOLICITUD_ESTADO["PENDIENTE"],
        choices=[
            (v, v) for v in SOLICITUD_ESTADO.values()
        ],
    )
    lugar_intercambio = models.CharField(max_length=255, null=True, blank=True)
    fecha_intercambio_pactada = models.DateTimeField(null=True, blank=True)
    fecha_completado = models.DateTimeField(null=True, blank=True)
    creada_en = models.DateTimeField(null=True, blank=True)
    actualizada_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'solicitud_intercambio'
        managed = False



class SolicitudOferta(models.Model):
    id_oferta = models.AutoField(primary_key=True)
    id_solicitud = models.ForeignKey(SolicitudIntercambio, db_column='id_solicitud',
                                     on_delete=models.CASCADE, related_name='ofertas')
    id_libro_ofrecido = models.ForeignKey('market.Libro', db_column='id_libro_ofrecido',
                                          on_delete=models.CASCADE, related_name='ofertas_en_solicitudes')

    class Meta:
        db_table = 'solicitud_oferta'
        managed = False

class Intercambio(models.Model):
    id_intercambio = models.AutoField(primary_key=True)
    id_solicitud = models.ForeignKey('market.SolicitudIntercambio', db_column='id_solicitud',
                                     on_delete=models.CASCADE, related_name='intercambio')
    id_libro_ofrecido_aceptado = models.ForeignKey('market.Libro', db_column='id_libro_ofrecido_aceptado',
                                                   on_delete=models.DO_NOTHING, related_name='intercambios_donde_fue_aceptado')
    lugar_intercambio = models.CharField(max_length=255, default='A coordinar')
    fecha_intercambio_pactada = models.DateTimeField(null=True, blank=True)
    estado_intercambio = models.CharField(
        max_length=12,
        default=INTERCAMBIO_ESTADO["PENDIENTE"],
        choices=[
            (v, v) for v in INTERCAMBIO_ESTADO.values()
        ],
    )
    fecha_completado = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'intercambio'
        managed = False

class IntercambioCodigo(models.Model):
    # PK es id_intercambio, por eso usamos OneToOneField con primary_key=True
    id_intercambio = models.OneToOneField('market.Intercambio', db_column='id_intercambio',
                                          on_delete=models.CASCADE, related_name='codigo', primary_key=True)
    codigo = models.CharField(max_length=12, unique=True)
    expira_en = models.DateTimeField(null=True, blank=True)
    usado_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'intercambio_codigo'
        managed = False





